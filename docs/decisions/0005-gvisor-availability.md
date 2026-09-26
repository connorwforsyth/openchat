# 0005: gVisor (`runsc`) availability and the sandbox fallback

- Status: accepted
- Date: 2026-09-26
- Ticket: [003](../../.wayfinder/tickets/003-risk-checks.md), `PLAN.md` §12 check 5
- Result: **PARTIAL**. Available on a typical Linux VPS; not on Docker Desktop for macOS.
  Fallback recorded below.

## Context

D7: the `sandbox-runner` runs one container per chat, under gVisor where the host supports
it. Otherwise it uses plain Docker, with a warning in the admin UI. D24: the web container
never gets the Docker socket. We need to know which hosts actually give us `runsc`.

## Check performed

- **Locally:** `docker` 29.4.0 CLI is installed, but the Docker Desktop daemon was not
  running (`failed to connect to the docker API at unix:///…/.docker/run/docker.sock`), and no
  `runsc` binary exists. Nothing could be run, so this record is **desk research** from
  official docs.
- **Sources** (fetched 2026-09-26):
  - gvisor.dev: Installation, Docker Quick Start, Platforms, FAQ.
  - docs.docker.com: Alternative container runtimes, Docker Desktop settings, Enhanced
    Container Isolation.

## Evidence

- **Linux only.** gVisor "supports x86_64 and ARM64, and requires Linux 5.6+" (gvisor.dev
  install guide). The FAQ also says gVisor requires Linux. There is no macOS build.
- **Linux VPS: yes.** Install `runsc`, run `sudo runsc install` (writes a `runsc` entry into
  `/etc/docker/daemon.json`), reload Docker, then `docker run --runtime=runsc …`.
  - The default platform is **systrap** (seccomp-based, default since mid-2023). It **does
    not need hardware virtualisation**, so it works on ordinary cloud VMs without nested
    virtualisation. KVM is optional and often slower inside a VM.
  - Any mainstream VPS image (Ubuntu 22.04+/Debian 12, kernel ≥ 5.15) meets the 5.6 floor.
- **Docker Desktop for macOS: no supported path.**
  - Containers run inside Docker Desktop's managed Linux VM.
  - Docker Desktop exposes `daemon.json` editing (Settings → Docker Engine), so a `runtimes`
    entry can be declared. But there is no documented way to install the `runsc` binary
    into the VM.
  - Community workarounds copy it in through a privileged container. They are unsupported
    and don't survive VM resets or Desktop updates.
  - Docker's own hardened alternative, Enhanced Container Isolation (Sysbox), is a Docker
    enterprise/Hardened Desktop feature. It is not something we can assume on free tiers, and
    it is not gVisor.
- Docker's alternative-runtimes docs register runsc as a containerd shim
  (`"runtimeType": "io.containerd.runsc.v1"`) or through `daemon.json` `runtimes`. Either way
  it shows up in `docker info` → `Runtimes`, which is how the runner can detect it.

## Consequence for the plan

D7's design holds. The fallback becomes concrete:

- **Detection:** at start-up, `sandbox-runner` reads `docker info` `Runtimes`. If `runsc` is
  present, every sandbox gets `HostConfig.Runtime = "runsc"`. Otherwise it uses `runc` and
  raises the admin-UI warning. An env override (`SANDBOX_RUNTIME=runsc|runc`) lets operators
  force it; `runsc` fails closed if it is missing.
- **Fallback: plain runc plus hardening**, always applied (also under runsc, as defence in
  depth):
  - `--cap-drop=ALL` (add back only what package installs need);
  - `--security-opt no-new-privileges`, the default seccomp profile, and AppArmor where the
    host has it;
  - a non-root user, and user-namespace remapping (`userns-remap`) where the operator
    enables it;
  - `--read-only` root filesystem, with writable space only in the per-sandbox volume and a
    size-capped `tmpfs` at `/tmp`;
  - `--pids-limit`, `--memory`/`--memory-swap`, `--cpus`, and a disk quota on the volume;
  - no host mounts;
  - a per-sandbox network with the egress policy (default deny except the package
    registries allowed in config);
  - Docker access only through the socket proxy (D7/D24).
- **Development on macOS:** always runs the runc path. The admin warning shows, which is
  expected.
- **Production docs** (open-source wave): recommend a Linux host with `runsc` installed and
  list the three commands above.
- **CI:** GitHub-hosted Ubuntu runners can install `runsc` (kernel ≥ 5.6, systrap). The
  sandbox-runner integration test should run once per runtime so both paths stay working.
- **Not verified empirically:** no container was started under either runtime on this
  machine. The first sandbox-runner ticket should repeat this on a Linux host.

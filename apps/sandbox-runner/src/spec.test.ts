import { fixtureId } from "@workspace/contract/fixtures";
import { describe, expect, it } from "vitest";

import {
  buildContainerSpec,
  buildHelperSpec,
  buildNetworkSpec,
  type ContainerDefaults,
  effectiveEgress,
  parsePreviewHost,
  previewUrl,
  selectRuntime,
} from "./spec";

const id = fixtureId("sandbox", 1);
const defaults: ContainerDefaults = {
  image: "node:24-bookworm-slim",
  pidsLimit: 512,
  runtime: "runsc",
  storageQuota: false,
  tmpMb: 512,
  user: "1000:1000",
};
const limits = { cpu: 1.5, diskMb: 2048, memoryMb: 1024, network: false };
const MIB = 1024 * 1024;

describe("selectRuntime", () => {
  it("prefers gVisor when the daemon has it", () => {
    expect(
      selectRuntime(["io.containerd.runc.v2", "runc", "runsc"], "auto")
    ).toEqual({
      ok: true,
      value: { isolation: "gvisor", runtime: "runsc", warning: null },
    });
  });

  it("falls back to runc with a warning", () => {
    const choice = selectRuntime(["runc"], "auto");
    expect(choice.ok && choice.value).toMatchObject({
      isolation: "container",
      runtime: "runc",
    });
    expect(choice.ok && choice.value.warning).toContain("gVisor");
  });

  it("fails closed when runsc is required but missing", () => {
    expect(selectRuntime(["runc"], "runsc").ok).toBe(false);
  });

  it("lets operators force runc, still with a warning", () => {
    const choice = selectRuntime(["runc", "runsc"], "runc");
    expect(choice.ok && choice.value.runtime).toBe("runc");
    expect(choice.ok && choice.value.warning).not.toBeNull();
  });
});

describe("buildContainerSpec", () => {
  const spec = buildContainerSpec({
    defaults,
    egress: { mode: "none" },
    id,
    limits,
  });
  const host = spec.HostConfig ?? {};

  it("mounts nothing from the host", () => {
    expect(host.Binds).toBeUndefined();
    expect(host.Mounts).toEqual([
      { ReadOnly: false, Source: `sbx-${id}`, Target: "/work", Type: "volume" },
    ]);
    expect(host.Mounts?.every((mount) => mount.Type === "volume")).toBe(true);
    expect(host.Devices).toBeUndefined();
    expect(Object.keys(host.Tmpfs ?? {})).toEqual(["/home/sandbox", "/tmp"]);
  });

  it("drops every capability and privilege", () => {
    expect(host.CapDrop).toEqual(["ALL"]);
    expect(host.CapAdd).toBeUndefined();
    expect(host.Privileged).toBe(false);
    expect(host.SecurityOpt).toContain("no-new-privileges:true");
    expect(host.ReadonlyRootfs).toBe(true);
    expect(spec.User).toBe("1000:1000");
  });

  it("applies CPU, memory, swap and pids limits", () => {
    expect(host.NanoCpus).toBe(1_500_000_000);
    expect(host.Memory).toBe(1024 * MIB);
    expect(host.MemorySwap).toBe(1024 * MIB);
    expect(host.PidsLimit).toBe(512);
    expect(host.Tmpfs?.["/tmp"]).toContain("size=512m");
    // The storage quota needs driver support, so it's opt-in.
    expect(host.StorageOpt).toBeUndefined();
    const quota = buildContainerSpec({
      defaults: { ...defaults, storageQuota: true },
      egress: { mode: "none" },
      id,
      limits,
    });
    expect(quota.HostConfig?.StorageOpt).toEqual({ size: "2048M" });
  });

  it("uses the chosen runtime", () => {
    expect(host.Runtime).toBe("runsc");
    const runc = buildContainerSpec({
      defaults: { ...defaults, runtime: "runc" },
      egress: { mode: "none" },
      id,
      limits,
    });
    expect(runc.HostConfig?.Runtime).toBe("runc");
  });

  it("puts the sandbox on its own internal network", () => {
    expect(host.NetworkMode).toBe(`sbx-${id}`);
    expect(buildNetworkSpec(id)).toMatchObject({
      Internal: true,
      Name: `sbx-${id}`,
    });
  });

  it("routes allowlisted egress through the proxy, unless the sandbox has no network", () => {
    const egress = {
      mode: "allowlist" as const,
      proxyUrl: "http://egress:3128",
    };
    const withNetwork = buildContainerSpec({
      defaults,
      egress,
      id,
      limits: { ...limits, network: true },
    });
    expect(withNetwork.Env).toContain("HTTPS_PROXY=http://egress:3128");
    expect(spec.Env?.some((entry) => entry.includes("PROXY"))).toBe(false);
    expect(effectiveEgress({ mode: "open" }, { network: false })).toEqual({
      mode: "none",
    });
  });
});

describe("buildHelperSpec", () => {
  it("has no network, and root may only chown", () => {
    const helper = buildHelperSpec({
      asRoot: true,
      cmd: ["chown", "1000:1000", "/work"],
      defaults,
      id,
      mounts: [{ readOnly: false, source: `sbx-${id}`, target: "/work" }],
    });
    expect(helper.HostConfig).toMatchObject({
      CapAdd: ["CHOWN", "FOWNER"],
      CapDrop: ["ALL"],
      NetworkMode: "none",
      Privileged: false,
      Runtime: "runsc",
    });
    expect(helper.User).toBe("0:0");
    const copy = buildHelperSpec({ cmd: ["cp"], defaults, id, mounts: [] });
    expect(copy.User).toBe("1000:1000");
    expect(copy.HostConfig?.CapAdd).toEqual([]);
  });
});

describe("previews", () => {
  it("round-trips the preview host", () => {
    const url = previewUrl(
      "http://{id}-{port}.sandbox.localhost:7071",
      id,
      5173
    );
    expect(url).toBe(`http://${id}-5173.sandbox.localhost:7071`);
    expect(parsePreviewHost(new URL(url).host)).toEqual({ id, port: 5173 });
    expect(parsePreviewHost("localhost:7071")).toBeNull();
    expect(parsePreviewHost(`${id}-99999.sandbox.localhost`)).toBeNull();
  });
});

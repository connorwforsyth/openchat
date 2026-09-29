import type { SandboxId } from "@workspace/contract/schemas/common";
import type { ExecResult } from "@workspace/contract/schemas/sandbox";
import { err, ok } from "@workspace/shared/result";

import type { Sandbox } from "../ports/sandbox";
import { createMemorySandboxFactory } from "../ports/sandbox.memory";
import {
  createPreviewRestorer,
  type PreviewRestorerOptions,
} from "../preview-restore";
import type { ProviderEntry } from "../providers";

// A Docker-like provider for tests, over the memory sandbox. Its sandboxes
// say they're `docker`; `/proc/net/tcp` lists the ports their servers
// listen on; a `nohup node <script> <root> <port> …` starts one listening;
// and exposed ports live on the "runner" (`host.exposed`), which forgets
// them all when it restarts (`host.exposed.clear()`), as the real one does.

const TCP_HEADER =
  "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode";
const TCP6_HEADER =
  "  sl  local_address                         remote_address                        st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode";

/** `/proc/net/tcp` and `tcp6` with a listener on 0.0.0.0 for each port. */
export const socketTables = (ports: Iterable<number>): string =>
  [
    TCP_HEADER,
    ...[...ports].map(
      (port, index) =>
        `   ${index}: 00000000:${port.toString(16).toUpperCase().padStart(4, "0")} 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 1234${index} 1 0000000000000000 100 0 0 10 0`
    ),
    TCP6_HEADER,
    "",
  ].join("\n");

const START = /^nohup node \S+ \S+ (\d+) /;

const ran = (stdout: string): ExecResult => ({
  durationMs: 1,
  exitCode: 0,
  stderr: "",
  stdout,
  timedOut: false,
  truncated: false,
});

export interface DockerLikeHost {
  /** Every command run, in order. */
  readonly commands: string[];
  /** `exposePort` calls, by sandbox (the runner counts them as activity). */
  readonly exposeCalls: Map<SandboxId, number>;
  /** Ports the runner serves, by sandbox. */
  readonly exposed: Map<SandboxId, Set<number>>;
  /** When set, `exposePort` fails. */
  failExpose: boolean;
  /** Ports something listens on, by sandbox; clear one to "stop" it. */
  readonly listening: Map<SandboxId, Set<number>>;
  /** When unset, a started server never comes up. */
  serverStarts: boolean;
  /** Sandboxes whose container is stopped (idle), as `status` reports them. */
  readonly stopped: Set<SandboxId>;
}

export const previewUrlFor = (id: SandboxId, port: number) =>
  `http://${id}-${port}.preview.test`;

export const createDockerLikeEntry = (
  restore: PreviewRestorerOptions | false = {}
): { readonly entry: ProviderEntry; readonly host: DockerLikeHost } => {
  const inner = createMemorySandboxFactory();
  const host: DockerLikeHost = {
    commands: [],
    exposeCalls: new Map(),
    exposed: new Map(),
    failExpose: false,
    listening: new Map(),
    serverStarts: true,
    stopped: new Set(),
  };
  const setOf = (map: Map<SandboxId, Set<number>>, id: SandboxId) => {
    const existing = map.get(id);
    if (existing) {
      return existing;
    }
    const created = new Set<number>();
    map.set(id, created);
    return created;
  };

  const dockerLike = (sandbox: Sandbox): Sandbox => ({
    ...sandbox,
    exec: (command, options) => {
      host.commands.push(command);
      if (command.includes("/proc/net/tcp")) {
        return Promise.resolve(
          ok(ran(socketTables(setOf(host.listening, sandbox.id))))
        );
      }
      const started = START.exec(command);
      if (started) {
        if (host.serverStarts) {
          setOf(host.listening, sandbox.id).add(Number(started[1]));
        }
        return Promise.resolve(ok(ran("")));
      }
      return sandbox.exec(command, options);
    },
    exposePort: (port) => {
      host.exposeCalls.set(
        sandbox.id,
        (host.exposeCalls.get(sandbox.id) ?? 0) + 1
      );
      if (host.failExpose) {
        return Promise.resolve(
          err({ message: "no preview origin", type: "unavailable" as const })
        );
      }
      setOf(host.exposed, sandbox.id).add(port);
      return Promise.resolve(
        ok({ port, url: previewUrlFor(sandbox.id, port) })
      );
    },
    provider: "docker",
    status: () =>
      Promise.resolve(
        ok({
          state: host.stopped.has(sandbox.id)
            ? ("stopped" as const)
            : ("ready" as const),
        })
      ),
  });

  const entry: ProviderEntry = {
    factory: {
      attach: async (id) => {
        const attached = await inner.attach(id);
        return attached.ok ? ok(dockerLike(attached.value)) : attached;
      },
      create: async (spec) => {
        const created = await inner.create(spec);
        return created.ok ? ok(dockerLike(created.value)) : created;
      },
      provider: "docker",
    },
    isolation: () => Promise.resolve(ok("container" as const)),
    limits: { cpu: 1, diskMb: 64, memoryMb: 256, network: false },
    ...(restore === false
      ? {}
      : {
          restorePreviews: createPreviewRestorer({
            log: () => undefined,
            sleep: () => Promise.resolve(),
            ...restore,
          }),
        }),
  };
  return { entry, host };
};

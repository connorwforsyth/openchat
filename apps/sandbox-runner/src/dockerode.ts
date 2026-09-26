import { PassThrough } from "node:stream";

import Docker from "dockerode";

import type { ContainerState, DockerPort } from "./docker-port";

// The DockerPort over dockerode, pointed at the socket proxy (never the raw
// socket; D7, D24). Adapters may wrap class-based SDKs; this is the only
// file that touches dockerode.

const TCP_SCHEME = /^tcp:/;

/** `tcp://proxy:2375`, `http://proxy:2375` or `unix:///var/run/docker.sock`. */
export const dockerOptionsFromUrl = (url: string): Docker.DockerOptions => {
  if (url.startsWith("unix://")) {
    return { socketPath: url.slice("unix://".length) };
  }
  const parsed = new URL(url.replace(TCP_SCHEME, "http:"));
  return {
    host: parsed.hostname,
    port: parsed.port || (parsed.protocol === "https:" ? "443" : "2375"),
    protocol: parsed.protocol === "https:" ? "https" : "http",
  };
};

const statusOf = (cause: unknown): number | undefined =>
  typeof cause === "object" && cause !== null && "statusCode" in cause
    ? Number((cause as { statusCode: unknown }).statusCode)
    : undefined;

/** Runs `action`, treating the listed HTTP statuses as success. */
const tolerate = async (
  action: () => Promise<unknown>,
  statuses: readonly number[]
): Promise<void> => {
  try {
    await action();
  } catch (cause) {
    if (!statuses.includes(statusOf(cause) ?? 0)) {
      throw cause;
    }
  }
};

export const createDockerodePort = (url: string): DockerPort => {
  const docker = new Docker(dockerOptionsFromUrl(url));

  return {
    connectNetwork: (network, container) =>
      // 403: already attached.
      tolerate(
        () => docker.getNetwork(network).connect({ Container: container }),
        [403]
      ),

    createContainer: async (spec) => (await docker.createContainer(spec)).id,

    createNetwork: async (spec) => {
      await tolerate(
        () => docker.createNetwork({ ...spec, Labels: { ...spec.Labels } }),
        [409]
      );
    },

    createVolume: async (name, labels) => {
      await docker.createVolume({ Labels: { ...labels }, Name: name });
    },

    disconnectNetwork: (network, container) =>
      // 403: not attached; 404: no such network or container.
      tolerate(
        () =>
          docker
            .getNetwork(network)
            .disconnect({ Container: container, Force: true }),
        [403, 404]
      ),

    ensureImage: async (image) => {
      try {
        await docker.getImage(image).inspect();
        return;
      } catch (cause) {
        if (statusOf(cause) !== 404) {
          throw cause;
        }
      }
      const stream = await docker.pull(image);
      await new Promise<void>((resolve, reject) => {
        docker.modem.followProgress(stream, (error) =>
          error ? reject(error) : resolve()
        );
      });
    },

    exec: async (container, spec, onOutput, signal) => {
      const exec = await docker.getContainer(container).exec({
        AttachStderr: true,
        AttachStdout: true,
        Cmd: [...spec.cmd],
        Env: spec.env ? [...spec.env] : undefined,
        WorkingDir: spec.workdir,
      });
      const stream = await exec.start({ Detach: false, Tty: false });
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      stdout.on("data", (chunk: Buffer) =>
        onOutput("stdout", chunk.toString("utf8"))
      );
      stderr.on("data", (chunk: Buffer) =>
        onOutput("stderr", chunk.toString("utf8"))
      );
      docker.modem.demuxStream(stream, stdout, stderr);
      await new Promise<void>((resolve, reject) => {
        const abort = () => {
          // Closing our end detaches; the in-container `timeout` does the killing.
          stream.destroy();
          resolve();
        };
        signal?.addEventListener("abort", abort, { once: true });
        stream.on("end", resolve);
        stream.on("close", resolve);
        stream.on("error", reject);
      });
      const inspected = await exec.inspect();
      return inspected.ExitCode ?? -1;
    },

    inspectContainer: async (nameOrId) => {
      try {
        const info = await docker.getContainer(nameOrId).inspect();
        const ips: Record<string, string> = {};
        for (const [name, network] of Object.entries(
          info.NetworkSettings.Networks
        )) {
          if (network.IPAddress) {
            ips[name] = network.IPAddress;
          }
        }
        const state: ContainerState = {
          id: info.Id,
          ips,
          labels: info.Config.Labels,
          running: info.State.Running,
        };
        return state;
      } catch (cause) {
        if (statusOf(cause) === 404) {
          return null;
        }
        throw cause;
      }
    },

    listContainers: async (label, value) => {
      const found = await docker.listContainers({
        all: true,
        filters: { label: [value === undefined ? label : `${label}=${value}`] },
      });
      return found.map((container) => ({
        id: container.Id,
        ips: Object.fromEntries(
          Object.entries(container.NetworkSettings?.Networks ?? {}).map(
            ([name, network]) => [name, network.IPAddress]
          )
        ),
        labels: container.Labels ?? {},
        running: container.State === "running",
      }));
    },

    listRuntimes: async () => {
      const info = (await docker.info()) as {
        Runtimes?: Record<string, unknown>;
      };
      return Object.keys(info.Runtimes ?? {});
    },

    networkExists: async (name) => {
      try {
        await docker.getNetwork(name).inspect();
        return true;
      } catch (cause) {
        if (statusOf(cause) === 404) {
          return false;
        }
        throw cause;
      }
    },

    removeContainer: (nameOrId) =>
      tolerate(
        () => docker.getContainer(nameOrId).remove({ force: true, v: false }),
        [404]
      ),

    removeNetwork: (name) =>
      tolerate(() => docker.getNetwork(name).remove(), [404]),

    removeVolume: (name) =>
      tolerate(() => docker.getVolume(name).remove(), [404]),

    // 304: already running / already stopped.
    startContainer: (nameOrId) =>
      tolerate(() => docker.getContainer(nameOrId).start(), [304]),

    stopContainer: (nameOrId) =>
      tolerate(() => docker.getContainer(nameOrId).stop({ t: 5 }), [304, 404]),

    waitContainer: async (nameOrId) => {
      const result = (await docker.getContainer(nameOrId).wait()) as {
        StatusCode?: number;
      };
      return result.StatusCode ?? -1;
    },
  };
};

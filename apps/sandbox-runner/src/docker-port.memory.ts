import type { ContainerCreateOptions } from "dockerode";
import { Bash, type IFileSystem, InMemoryFs, MountableFs } from "just-bash";

import type { ContainerState, DockerPort } from "./docker-port";

// An in-memory Docker for tests: volumes are just-bash filesystems, and
// `exec` runs the command through just-bash with the container's volumes
// mounted, so the runner's real scripts (`timeout … bash -c`, `base64`,
// `stat`) run unchanged. `find -printf` is the one thing just-bash lacks, so
// it's answered here. Every create is recorded for assertions.

interface FakeContainer {
  readonly id: string;
  readonly name: string;
  running: boolean;
  readonly spec: ContainerCreateOptions;
}

const quote = (arg: string) => `'${arg.replaceAll("'", `'\\''`)}'`;

export const createMemoryDocker = ({
  runtimes = ["runc"],
}: {
  readonly runtimes?: readonly string[];
} = {}) => {
  const containers = new Map<string, FakeContainer>();
  const volumes = new Map<string, InMemoryFs>();
  const networks = new Map<
    string,
    { internal: boolean; members: Set<string> }
  >();
  const created: ContainerCreateOptions[] = [];
  /** Every `connectNetwork` call, as `network container`. */
  const connects: string[] = [];
  const pulled: string[] = [];
  let failNext: string | null = null;
  let counter = 0;

  const find = (nameOrId: string) =>
    containers.get(nameOrId) ??
    [...containers.values()].find((container) => container.name === nameOrId);

  const mountsOf = (spec: ContainerCreateOptions) =>
    (spec.HostConfig?.Mounts ?? []).map((mount) => ({
      readOnly: mount.ReadOnly ?? false,
      source: mount.Source ?? "",
      target: mount.Target,
    }));

  const volume = (name: string) => {
    let fs = volumes.get(name);
    if (!fs) {
      fs = new InMemoryFs();
      volumes.set(name, fs);
    }
    return fs;
  };

  const filesystemOf = (container: FakeContainer): IFileSystem => {
    const fs = new MountableFs({ base: new InMemoryFs() });
    for (const mount of mountsOf(container.spec)) {
      fs.mount(mount.target, volume(mount.source));
    }
    return fs;
  };

  const copyVolume = async (from: InMemoryFs, to: InMemoryFs) => {
    for (const path of from.getAllPaths().sort()) {
      // biome-ignore lint/performance/noAwaitInLoops: directories must exist before their files.
      const stat = await from.stat(path);
      if (stat.isDirectory) {
        await to.mkdir(path, { recursive: true });
      } else {
        await to.writeFile(path, await from.readFileBuffer(path));
      }
    }
  };

  /** `find DIR -mindepth 1 [-maxdepth 1] -printf …` as the runner calls it. */
  const findFiles = async (fs: IFileSystem, args: readonly string[]) => {
    const [dir = "/"] = args;
    const shallow = args.includes("-maxdepth");
    if (!((await fs.exists(dir)) && (await fs.stat(dir)).isDirectory)) {
      return { code: 1, stdout: "" };
    }
    const records: string[] = [];
    const walk = async (path: string) => {
      for (const name of await fs.readdir(path)) {
        const child = `${path === "/" ? "" : path}/${name}`;
        // biome-ignore lint/performance/noAwaitInLoops: a depth-first walk, like find's own order.
        const stat = await fs.lstat(child);
        let kind = "f";
        if (stat.isSymbolicLink) {
          kind = "l";
        } else if (stat.isDirectory) {
          kind = "d";
        }
        records.push(
          `${kind}\t${stat.size}\t${stat.mtime.getTime() / 1000}\t${child}\0`
        );
        if (kind === "d" && !shallow) {
          await walk(child);
        }
      }
    };
    await walk(dir);
    return { code: 0, stdout: records.join("") };
  };

  const guard = (operation: string) => {
    if (failNext === operation) {
      failNext = null;
      throw new Error(`fake docker: ${operation} failed`);
    }
  };

  const port: DockerPort = {
    connectNetwork: (network, container) => {
      guard("connectNetwork");
      connects.push(`${network} ${container}`);
      const found = networks.get(network);
      if (!found) {
        throw new Error(`network ${network} not found`);
      }
      found.members.add(container);
      return Promise.resolve();
    },

    createContainer: (spec) => {
      guard("createContainer");
      counter += 1;
      const id = `container-${counter}`;
      created.push(spec);
      containers.set(id, { id, name: spec.name ?? id, running: false, spec });
      return Promise.resolve(id);
    },

    createNetwork: (spec) => {
      guard("createNetwork");
      if (!networks.has(spec.Name)) {
        networks.set(spec.Name, {
          internal: spec.Internal,
          members: new Set(),
        });
      }
      return Promise.resolve();
    },

    createVolume: (name) => {
      guard("createVolume");
      volume(name);
      return Promise.resolve();
    },

    disconnectNetwork: (network, container) => {
      networks.get(network)?.members.delete(container);
      return Promise.resolve();
    },

    ensureImage: (image) => {
      guard("ensureImage");
      pulled.push(image);
      return Promise.resolve();
    },

    exec: async (nameOrId, spec, onOutput) => {
      guard("exec");
      const container = find(nameOrId);
      if (!container?.running) {
        throw new Error("container is not running");
      }
      const fs = filesystemOf(container);
      if (spec.cmd[0] === "find") {
        const listed = await findFiles(fs, spec.cmd.slice(1));
        if (listed.stdout) {
          onOutput("stdout", listed.stdout);
        }
        return listed.code;
      }
      const bash = new Bash({
        cwd: spec.workdir ?? container.spec.WorkingDir ?? "/",
        fs,
      });
      const env = Object.fromEntries(
        (spec.env ?? []).map((pair) => {
          const at = pair.indexOf("=");
          return [pair.slice(0, at), pair.slice(at + 1)];
        })
      );
      const result = await bash.exec(spec.cmd.map(quote).join(" "), { env });
      if (result.stdout) {
        onOutput("stdout", result.stdout);
      }
      if (result.stderr) {
        onOutput("stderr", result.stderr);
      }
      return result.exitCode;
    },

    inspectContainer: (nameOrId) => {
      guard("inspectContainer");
      const container = find(nameOrId);
      if (!container) {
        return Promise.resolve(null);
      }
      const ips: Record<string, string> = {};
      for (const [name, network] of networks) {
        if (
          network.members.has(container.name) ||
          container.spec.HostConfig?.NetworkMode === name
        ) {
          ips[name] = "10.0.0.2";
        }
      }
      const state: ContainerState = {
        id: container.id,
        ips,
        labels: container.spec.Labels ?? {},
        running: container.running,
      };
      return Promise.resolve(state);
    },

    listContainers: (label, value) =>
      Promise.resolve(
        [...containers.values()]
          .filter((container) => {
            const actual = container.spec.Labels?.[label];
            return value === undefined
              ? actual !== undefined
              : actual === value;
          })
          .map((container) => ({
            id: container.id,
            ips: {},
            labels: container.spec.Labels ?? {},
            running: container.running,
          }))
      ),

    listRuntimes: () => Promise.resolve([...runtimes]),

    networkExists: (name) => Promise.resolve(networks.has(name)),

    removeContainer: (nameOrId) => {
      guard("removeContainer");
      const container = find(nameOrId);
      if (container) {
        containers.delete(container.id);
      }
      return Promise.resolve();
    },

    removeNetwork: (name) => {
      if ((networks.get(name)?.members.size ?? 0) > 0) {
        throw new Error(`network ${name} has active endpoints`);
      }
      networks.delete(name);
      return Promise.resolve();
    },

    removeVolume: (name) => {
      volumes.delete(name);
      return Promise.resolve();
    },

    startContainer: (nameOrId) => {
      guard("startContainer");
      const container = find(nameOrId);
      if (!container) {
        throw new Error("no such container");
      }
      container.running = true;
      return Promise.resolve();
    },

    stopContainer: (nameOrId) => {
      const container = find(nameOrId);
      if (container) {
        container.running = false;
      }
      return Promise.resolve();
    },

    // Helper containers do their one job here: `chown` is a no-op, `cp`
    // copies one volume into another.
    waitContainer: async (nameOrId) => {
      const container = find(nameOrId);
      if (!container) {
        throw new Error("no such container");
      }
      const cmd = container.spec.Cmd ?? [];
      const mounts = mountsOf(container.spec);
      if (cmd[0] === "cp") {
        const from = mounts.find((mount) => mount.readOnly);
        const to = mounts.find((mount) => !mount.readOnly);
        if (!(from && to)) {
          return 1;
        }
        await copyVolume(volume(from.source), volume(to.source));
      }
      container.running = false;
      return 0;
    },
  };

  return {
    connects,
    containers: () => [...containers.values()],
    created,
    docker: port,
    /** Makes the next call to `operation` throw, like a Docker outage. */
    failNext: (operation: keyof DockerPort) => {
      failNext = operation;
    },
    networks,
    pulled,
    /**
     * `docker compose up --force-recreate` for a container outside this fake
     * (the runner itself): the new container is on none of the old one's
     * networks.
     */
    recreate: (container: string) => {
      for (const network of networks.values()) {
        network.members.delete(container);
      }
    },
    volumes,
  };
};

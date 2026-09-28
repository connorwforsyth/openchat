import { type Document, isMap, isSeq, parseDocument, type YAMLSeq } from "yaml";

import { unlessUnchanged } from "./config-file";

// `docker-compose.override.yml`: compose merges it over docker-compose.yml.
// The wizard needs two things in it (docs/self-hosting.md, "Configuration
// file"): app.config.yaml mounted into `web`, and `CONFIG_PATH` pointing at
// the mount. Anything else already in the file is left alone.

export const CONFIG_MOUNT_TARGET = "/config/app.config.yaml";
export const CONFIG_MOUNT = `./app.config.yaml:${CONFIG_MOUNT_TARGET}:ro`;
/** Lets `web` reach a model server on the host on Linux; Docker Desktop has it built in. */
export const HOST_GATEWAY = "host.docker.internal:host-gateway";

const HEADER =
  " Written by `bun run setup`: mounts app.config.yaml into `web`\n (docs/self-hosting.md). Your own additions are kept on a re-run.";

const web = ["services", "web"] as const;

const seqAt = (doc: Document, path: readonly string[]): YAMLSeq => {
  const node = doc.getIn(path, true);
  if (isSeq(node)) {
    return node;
  }
  const seq = doc.createNode([]) as YAMLSeq;
  doc.setIn(path, seq);
  return seq;
};

/** Strings in a sequence node, by index (non-strings are `undefined`). */
const strings = (seq: YAMLSeq): (string | undefined)[] =>
  (seq.toJSON() as unknown[]).map((item) =>
    typeof item === "string" ? item : undefined
  );

/** Sets `items[index]`, or appends when `index` is -1; no-op when already equal. */
const put = (seq: YAMLSeq, index: number, value: string): void => {
  if (index === -1) {
    seq.add(value);
  } else if (strings(seq)[index] !== value) {
    seq.set(index, value);
  }
};

const setEnvironment = (doc: Document, name: string, value: string): void => {
  const path = [...web, "environment"];
  const node = doc.getIn(path, true);
  if (isSeq(node)) {
    // The list form: `- CONFIG_PATH=/config/app.config.yaml`.
    const index = strings(node).findIndex((item) =>
      item?.startsWith(`${name}=`)
    );
    put(node, index, `${name}=${value}`);
    return;
  }
  if (!isMap(node) || node.get(name) !== value) {
    doc.setIn([...path, name], value);
  }
};

const mountTarget = (volume: string | undefined): string | undefined =>
  volume?.split(":")[1];

/** Mounts the config, replacing any other file mounted at the same target. */
const mountConfig = (doc: Document): void => {
  const volumes = seqAt(doc, [...web, "volumes"]);
  const index = strings(volumes).findIndex(
    (volume) => mountTarget(volume) === CONFIG_MOUNT_TARGET
  );
  put(volumes, index, CONFIG_MOUNT);
};

export interface OverrideOptions {
  /** Add the host gateway, for a model server on the host. */
  readonly hostGateway: boolean;
}

/** `base` is the current file, or undefined when there's none yet. */
export const updateOverride = (
  base: string | undefined,
  { hostGateway }: OverrideOptions
): string => {
  const doc = parseDocument(base ?? "");
  if (base === undefined || base.trim() === "") {
    doc.commentBefore = HEADER;
  }
  setEnvironment(doc, "CONFIG_PATH", CONFIG_MOUNT_TARGET);
  mountConfig(doc);
  if (hostGateway) {
    const hosts = seqAt(doc, [...web, "extra_hosts"]);
    put(hosts, strings(hosts).indexOf(HOST_GATEWAY), HOST_GATEWAY);
  }
  return base ? unlessUnchanged(base, doc) : doc.toString({ lineWidth: 0 });
};

/** Whether an override already mounts the config the way the wizard does. */
export const mountsConfig = (text: string | undefined): boolean => {
  if (!text) {
    return false;
  }
  const doc = parseDocument(text);
  const volumes = doc.getIn([...web, "volumes"]);
  return (
    isSeq(volumes) &&
    strings(volumes).some(
      (volume) => mountTarget(volume) === CONFIG_MOUNT_TARGET
    )
  );
};

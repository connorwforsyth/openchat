import { readFileSync } from "node:fs";
import { join, posix } from "node:path";

import { parseConfig } from "@workspace/config/parse";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { z } from "zod";

import type { Answers } from "./answers";
import { LEGACY_DOCKER_STORAGE_PATH } from "./config-file";
import {
  configExample,
  demoAnswers,
  fakeRandom,
  firstRun,
  localAnswers,
} from "./fixtures";
import { FILES, planChanges } from "./plan";

// Where uploads land (ticket 053). The image runs from its WORKDIR with a
// volume mounted by compose, so a relative `storage.path` persists only if it
// resolves into that volume; under `bun dev` it should stay in the
// git-ignored `./.data`. Read from the real Dockerfile and compose file, so
// moving the volume, the working directory, the default or the `.data` link
// breaks this rather than someone's uploads.

const root = join(import.meta.dirname, "..", "..", "..");
const dockerfile = readFileSync(join(root, "apps/web/Dockerfile"), "utf8");
const compose = z
  .object({
    services: z.object({
      web: z.object({ volumes: z.array(z.string()) }),
    }),
  })
  .parse(parse(readFileSync(join(root, "docker-compose.yml"), "utf8")));

/** The runtime stage: everything after the last `FROM`. */
const runtime = dockerfile.slice(dockerfile.lastIndexOf("\nFROM "));
const workdir = [...runtime.matchAll(/^WORKDIR (\S+)$/gm)].at(-1)?.[1] ?? "/";
/** `ln -s <target> <link>` in the runtime stage, as absolute paths. */
const links = [...runtime.matchAll(/\bln -s (\S+) (\S+)/g)].map(
  ([, target = "", link = ""]) => {
    const at = posix.resolve(workdir, link);
    return { at, to: posix.resolve(posix.dirname(at), target) };
  }
);
const volume = compose.services.web.volumes
  .map((mount) => mount.split(":"))
  .find(([source]) => source === "web-data")?.[1];

/** A path as the server in the image opens it: from WORKDIR, through the links. */
const inImage = (path: string): string =>
  links.reduce(
    (resolved, { at, to }) =>
      resolved === at || resolved.startsWith(`${at}/`)
        ? to + resolved.slice(at.length)
        : resolved,
    posix.resolve(workdir, path)
  );

/** A path as `bun dev` opens it, relative to apps/web. */
const inDev = (path: string): string =>
  posix.relative("/repo/apps/web", posix.resolve("/repo/apps/web", path));

const isInside = (path: string, dir: string) =>
  path === dir || path.startsWith(`${dir}/`);

const localPath = (config: unknown): string => {
  const storage = z
    .object({ storage: z.object({ path: z.string() }) })
    .parse(parse(String(config)));
  return storage.storage.path;
};

const setupWrites = (answers: Answers): string => {
  const result = planChanges(firstRun, answers, fakeRandom());
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  const config = result.value.find(
    (change) => change.path === FILES.config
  )?.after;
  return localPath(config);
};

const schemaDefault = (() => {
  const parsed = parseConfig("", {});
  if (!parsed.ok || parsed.value.storage.driver !== "local") {
    throw new Error("the default storage isn't local");
  }
  return parsed.value.storage.path;
})();

describe("the local file store's path", () => {
  it("reads the image and compose file", () => {
    expect(volume).toBeDefined();
    expect(workdir).not.toBe("/");
  });

  it.each([
    ["the default, with no app.config.yaml", schemaDefault],
    ["app.config.example.yaml", localPath(configExample)],
    ["what setup writes for Docker", setupWrites(demoAnswers)],
    ["what setup used to write for Docker", LEGACY_DOCKER_STORAGE_PATH],
  ])("%s lands in the web-data volume in the image", (_name, path) => {
    expect(isInside(inImage(path), volume ?? "")).toBe(true);
  });

  it.each([
    ["the default, with no app.config.yaml", schemaDefault],
    ["app.config.example.yaml", localPath(configExample)],
    ["what setup writes for bun dev", setupWrites(localAnswers)],
  ])("%s stays in the git-ignored .data under bun dev", (_name, path) => {
    expect(isInside(inDev(path), ".data")).toBe(true);
  });
});

import { type Env, interpolateEnv } from "@workspace/config/parse";
import { parseModelRef } from "@workspace/contract/schemas/models";
import {
  type Document,
  isMap,
  isScalar,
  parseDocument,
  type YAMLMap,
  type YAMLSeq,
} from "yaml";

import {
  type Answers,
  compatibleKeyVariable,
  keyVariables,
  type NativeProvider,
  nativeProviders,
} from "./answers";

// Applies answers to `app.config.yaml` as edits to the parsed document, so
// comments, key order and flow style (`icons: { set: lucide }`) survive and a
// re-run changes only what was asked. Secrets never land here: providers get
// `${NAME}` references and the values go to `.env` (D18).

type Path = readonly (string | number)[];

/**
 * Where the local file store keeps uploads, in both modes: beside the
 * embedded database, which git ignores, and in the Docker image the data
 * volume, which `./.data` links to (apps/web/Dockerfile).
 */
export const STORAGE_PATH = "./.data/files";
/**
 * What setup used to write for Docker, before the image linked `./.data`
 * into the volume. It's the same directory there, so a Docker config keeps it.
 */
export const LEGACY_DOCKER_STORAGE_PATH = "./data/files";

const EMBEDDINGS_MODEL = "openai:text-embedding-3-small";

/** A `${NAME}` (or `${NAME:-fallback}`) reference, resolved by the app at boot. */
export const envRef = (name: string, fallback?: string): string =>
  fallback === undefined ? `\${${name}}` : `\${${name}:-${fallback}}`;

const SEARXNG_URL = envRef("SEARXNG_URL", "http://localhost:8080");
const RUNNER_URL = envRef("SANDBOX_RUNNER_URL", "http://sandbox-runner:7070");
const RUNNER_TOKEN = envRef("SANDBOX_RUNNER_TOKEN");

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Plain JS of the value at `path`, or undefined. */
const read = (doc: Document, path: Path): unknown => {
  const node = doc.getIn(path, true);
  if (node === undefined || node === null) {
    return;
  }
  return isScalar(node) ? node.value : doc.getIn(path);
};

const readRecord = (doc: Document, path: Path): Record<string, unknown> => {
  const node = doc.getIn(path);
  return isMap(node) ? (node.toJSON() as Record<string, unknown>) : {};
};

/** Sets a value only when it differs, so untouched keys keep their formatting. */
const set = (doc: Document, path: Path, value: unknown): void => {
  if (read(doc, path) === value && value !== undefined) {
    return;
  }
  doc.setIn(path, value);
};

/** A new mapping in flow style, to match the example's one-line blocks. */
const flowMap = (doc: Document, value: Record<string, unknown>): YAMLMap => {
  const node = doc.createNode(value) as YAMLMap;
  node.flow = true;
  return node;
};

const remove = (doc: Document, path: Path): void => {
  if (doc.hasIn(path)) {
    doc.deleteIn(path);
  }
};

/** The one OpenAI-compatible provider the wizard manages: the first one listed. */
export const compatibleProvider = (
  providers: Record<string, unknown>
): { readonly baseURL: unknown; readonly id: string } | null => {
  for (const [id, provider] of Object.entries(providers)) {
    if (
      isRecord(provider) &&
      provider.type === "openai-compatible" &&
      !(nativeProviders as readonly string[]).includes(id)
    ) {
      return { baseURL: provider.baseURL, id };
    }
  }
  return null;
};

/** A `${NAME:-default}` value as the app would see it with this env. */
export const resolveValue = (value: unknown, env: Env): unknown =>
  interpolateEnv(value, env).value;

const applyProviders = (doc: Document, answers: Answers, env: Env): void => {
  for (const provider of nativeProviders) {
    if (answers.providers.includes(provider)) {
      if (!doc.hasIn(["providers", provider])) {
        doc.setIn(
          ["providers", provider],
          flowMap(doc, { apiKey: envRef(keyVariables[provider]) })
        );
      }
    } else {
      remove(doc, ["providers", provider]);
    }
  }

  const existing = compatibleProvider(readRecord(doc, ["providers"]));
  const wanted = answers.providers.includes("compatible")
    ? answers.compatible
    : null;
  if (existing && existing.id !== wanted?.id) {
    remove(doc, ["providers", existing.id]);
  }
  if (wanted) {
    if (existing?.id === wanted.id) {
      // Keep `${OLLAMA_BASE_URL:-…}` when it still resolves to the answer.
      if (resolveValue(existing.baseURL, env) !== wanted.baseURL) {
        doc.setIn(["providers", wanted.id, "baseURL"], wanted.baseURL);
      }
    } else {
      doc.setIn(
        ["providers", wanted.id],
        flowMap(doc, { baseURL: wanted.baseURL, type: "openai-compatible" })
      );
    }
    // Most local servers need no key; a hosted gateway does.
    const keyVariable = compatibleKeyVariable(wanted.id);
    if (env[keyVariable] && !doc.hasIn(["providers", wanted.id, "apiKey"])) {
      doc.setIn(["providers", wanted.id, "apiKey"], envRef(keyVariable));
    }
  }

  // No providers at all means the schema's default: a local Ollama.
  if (Object.keys(readRecord(doc, ["providers"])).length === 0) {
    remove(doc, ["providers"]);
  }
};

/** Whether a selector still points at something after the edits. */
const resolves = (doc: Document, selector: unknown): boolean => {
  if (selector === null || selector === undefined || selector === "auto") {
    return true;
  }
  if (typeof selector !== "string") {
    return false;
  }
  const ref = parseModelRef(selector);
  if (ref) {
    const providers = doc.hasIn(["providers"])
      ? readRecord(doc, ["providers"])
      : { ollama: {} };
    return ref.provider in providers;
  }
  return selector in readRecord(doc, ["models", "aliases"]);
};

/**
 * Descriptions (096) and ratings (099) stay unless what they describe has
 * gone: the config refuses one for a model it can't find.
 */
const pruneDescriptions = (doc: Document): void => {
  for (const section of ["descriptions", "ratings"]) {
    for (const selector of Object.keys(readRecord(doc, ["models", section]))) {
      if (selector === "auto" || !resolves(doc, selector)) {
        remove(doc, ["models", section, selector]);
      }
    }
  }
};

const applyModels = (doc: Document, answers: Answers): void => {
  const models = { fast: answers.fastModel, strong: answers.strongModel };
  for (const [alias, ref] of Object.entries(models)) {
    if (ref) {
      set(doc, ["models", "aliases", alias], ref);
    } else {
      remove(doc, ["models", "aliases", alias]);
    }
  }
  // Hand-added aliases stay unless their provider has gone.
  for (const [alias, ref] of Object.entries(
    readRecord(doc, ["models", "aliases"])
  )) {
    if (!resolves(doc, ref)) {
      remove(doc, ["models", "aliases", alias]);
    }
  }
  if (!doc.hasIn(["models", "aliases"])) {
    doc.setIn(["models", "aliases"], flowMap(doc, {}));
  }
  pruneDescriptions(doc);

  let defaultModel: string | null = null;
  if (models.strong) {
    defaultModel = "strong";
  } else if (models.fast) {
    defaultModel = "fast";
  }
  set(doc, ["models", "default"], defaultModel);

  const both = Boolean(models.fast && models.strong);
  set(doc, ["models", "auto", "enabled"], both);
  set(doc, ["models", "auto", "cheap"], both ? "fast" : null);
  set(doc, ["models", "auto", "strong"], both ? "strong" : null);

  if (!resolves(doc, read(doc, ["decider", "model"]))) {
    set(doc, ["decider", "model"], models.fast ? "fast" : null);
  }
  if (!resolves(doc, read(doc, ["embeddings", "model"]))) {
    set(
      doc,
      ["embeddings", "model"],
      answers.providers.includes("openai") ? EMBEDDINGS_MODEL : null
    );
  }
};

const applySearch = (doc: Document, answers: Answers): void => {
  const backend = read(doc, ["search", "backend"]);
  if (answers.search) {
    set(doc, ["search", "backend"], "searxng");
    if (!doc.hasIn(["search", "searxng"])) {
      doc.setIn(["search", "searxng"], flowMap(doc, { url: SEARXNG_URL }));
    }
  } else if (backend === "searxng") {
    // A paid backend someone set by hand isn't the wizard's to turn off.
    set(doc, ["search", "backend"], "none");
  }
};

const applySandbox = (doc: Document, answers: Answers): void => {
  set(doc, ["sandbox", "default"], answers.sandbox);
  if (answers.sandbox === "docker" && !doc.hasIn(["sandbox", "docker"])) {
    doc.setIn(["sandbox", "docker"], {
      runnerUrl: RUNNER_URL,
      token: RUNNER_TOKEN,
    });
  }
  if (answers.sandbox === "docker") {
    set(doc, ["sandbox", "egress", "mode"], answers.egress);
  }
};

const applyStorage = (doc: Document, answers: Answers): void => {
  const path = read(doc, ["storage", "path"]);
  // Under `bun dev` the legacy path isn't git-ignored, so local mode moves
  // it back; a path of your own is left alone.
  const replace =
    path === undefined ||
    (path === LEGACY_DOCKER_STORAGE_PATH && answers.mode === "local");
  if (read(doc, ["storage", "driver"]) !== "s3" && replace) {
    if (!doc.hasIn(["storage"])) {
      doc.setIn(
        ["storage"],
        flowMap(doc, { driver: "local", path: STORAGE_PATH })
      );
    }
    set(doc, ["storage", "path"], STORAGE_PATH);
  }
};

const applyIcons = (doc: Document, answers: Answers): void => {
  if (!doc.hasIn(["icons"])) {
    doc.setIn(["icons"], flowMap(doc, {}));
  }
  set(doc, ["icons", "set"], answers.icons.set);
  if (answers.icons.set === "material" && answers.icons.style) {
    set(doc, ["icons", "style"], answers.icons.style);
    // Not asked; there only when the file had them or `.env` did (130).
    for (const key of ["weight", "fill"] as const) {
      if (answers.icons[key] !== undefined) {
        set(doc, ["icons", key], answers.icons[key]);
      }
    }
  } else {
    for (const key of ["style", "weight", "fill"]) {
      remove(doc, ["icons", key]);
    }
  }
};

/**
 * The edited text, or `base` itself when the edits add up to nothing:
 * printing re-flows some hand formatting, which a no-op shouldn't touch.
 */
export const unlessUnchanged = (base: string, doc: Document): string =>
  JSON.stringify(parseDocument(base).toJS()) === JSON.stringify(doc.toJS())
    ? base
    : doc.toString({ lineWidth: 0 });

/**
 * `base` is the current `app.config.yaml`, or `app.config.example.yaml` on a
 * first run. `env` is the `.env` being written, to tell whether a
 * `${NAME:-default}` still says what the answer says.
 */
export const updateConfig = (
  base: string,
  answers: Answers,
  env: Env
): string => {
  const doc = parseDocument(base);
  set(doc, ["brand", "name"], answers.brandName);
  set(doc, ["auth", "signup"], answers.signup);
  if (answers.signup === "domain") {
    const domains = doc.createNode(answers.domains) as YAMLSeq;
    domains.flow = true;
    doc.setIn(["auth", "domains"], domains);
  }
  applyProviders(doc, answers, env);
  applyModels(doc, answers);
  applySearch(doc, answers);
  applySandbox(doc, answers);
  applyStorage(doc, answers);
  applyIcons(doc, answers);
  return unlessUnchanged(base, doc);
};

/** The providers a config names, for the doctor and for defaults. */
export const nativeProvidersIn = (
  providers: Record<string, unknown>
): NativeProvider[] =>
  nativeProviders.filter((provider) => provider in providers);

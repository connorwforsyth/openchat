import { parseModelRef } from "@workspace/contract/schemas/models";
import { parseDocument } from "yaml";

import {
  compatibleKeyVariable,
  type Defaults,
  iconSetSchema,
  iconStyleSchema,
  keyVariables,
  nativeProviders,
  sandboxChoiceSchema,
  signupSchema,
} from "./answers";
import {
  compatibleProvider,
  nativeProvidersIn,
  resolveValue,
} from "./config-file";
import { type EnvValues, parseEnv } from "./env-file";
import { mountsConfig } from "./override-file";

// Reads the files the wizard writes back into answers, so a re-run offers
// what's there now as every default. On a first run the examples stand in,
// which makes the defaults the documented ones.

/** The files the wizard reads; `undefined` when a file doesn't exist. */
export interface CurrentFiles {
  readonly config: string | undefined;
  readonly configExample: string;
  readonly env: string | undefined;
  readonly envExample: string;
  readonly override: string | undefined;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const record = (value: unknown): Record<string, unknown> =>
  isRecord(value) ? value : {};

/** A hand-broken file shouldn't stop the wizard that can fix it. */
const readYaml = (text: string): Record<string, unknown> => {
  const doc = parseDocument(text);
  return doc.errors.length > 0 ? {} : record(doc.toJS());
};

export const currentEnv = (files: CurrentFiles): EnvValues =>
  parseEnv(files.env ?? files.envExample);

/** An alias or a ref, as a ref; `null` when it's neither (or `auto`). */
const toRef = (
  selector: unknown,
  aliases: Record<string, unknown>
): string | null => {
  if (typeof selector !== "string") {
    return null;
  }
  if (parseModelRef(selector)) {
    return selector;
  }
  const target = aliases[selector];
  return typeof target === "string" && parseModelRef(target) ? target : null;
};

const pick = <T extends string>(
  schema: { safeParse: (value: unknown) => { success: boolean; data?: T } },
  value: unknown,
  fallback: T
): T => {
  const parsed = schema.safeParse(value);
  return parsed.success && parsed.data !== undefined ? parsed.data : fallback;
};

export const readDefaults = (files: CurrentFiles): Defaults => {
  const env = currentEnv(files);
  const config = readYaml(files.config ?? files.configExample);
  const firstRun = files.config === undefined;

  const providersBlock = config.providers;
  // No `providers` at all is the schema's default: a local Ollama.
  const providers = isRecord(providersBlock)
    ? providersBlock
    : { ollama: { type: "openai-compatible" } };
  const compatible = compatibleProvider(providers);
  const resolvedURL = compatible
    ? resolveValue(compatible.baseURL, env)
    : undefined;

  const models = record(config.models);
  const aliases = record(models.aliases);
  const auto = record(models.auto);
  const auth = record(config.auth);
  const icons = record(config.icons);
  const sandbox = record(config.sandbox);
  const search = record(config.search);

  const keyNames = [
    ...nativeProviders.map((provider) => keyVariables[provider]),
    ...(compatible ? [compatibleKeyVariable(compatible.id)] : []),
  ];

  const iconSet = pick(iconSetSchema, env.ICON_SET || icons.set, "lucide");

  return {
    // Search and artifacts previews each start another container, so a
    // first run leaves them off whatever the examples say.
    artifacts: files.env !== undefined && Boolean(env.ARTIFACTS_ORIGIN),
    brandName:
      typeof record(config.brand).name === "string"
        ? String(record(config.brand).name)
        : "Chat",
    compatible:
      compatible && typeof resolvedURL === "string" && URL.canParse(resolvedURL)
        ? { baseURL: resolvedURL, id: compatible.id }
        : null,
    database: env.DATABASE_URL ? "postgres" : "pglite",
    domains: Array.isArray(auth.domains) ? auth.domains.map(String) : [],
    egress: env.SANDBOX_EGRESS === "open" ? "open" : "none",
    fastModel: toRef(aliases.fast ?? auto.cheap, aliases),
    icons: {
      set: iconSet,
      style:
        iconSet === "material"
          ? pick(iconStyleSchema, env.ICON_STYLE || icons.style, "outlined")
          : null,
    },
    keysSet: keyNames.filter((name) => Boolean(env[name])),
    mode: mountsConfig(files.override) || firstRun ? "docker" : "local",
    providers: [
      ...nativeProvidersIn(providers),
      ...(compatible ? (["compatible"] as const) : []),
    ],
    sandbox: pick(sandboxChoiceSchema, sandbox.default, "just-bash"),
    search: !firstRun && search.backend === "searxng",
    signup: pick(signupSchema, auth.signup, "invite"),
    strongModel: toRef(aliases.strong ?? models.default, aliases),
  };
};

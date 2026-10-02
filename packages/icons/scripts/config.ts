import { type Env, interpolateEnv } from "@workspace/config/parse";
import { type IconsConfig, iconsSchema } from "@workspace/config/schema";

import type { Result } from "./registry";

// Which set (and Material variant) to build with (D19). The config's `icons`
// block decides (130). `ICON_*` variables apply only when there's no block
// (no config file, or no `icons` key in it): they're the explicit override
// for an image built from a context without a config, as Docker build args.
// Anywhere else they're ignored, and `iconEnvWarning` says so: a stray
// `ICON_SET` in `.env` quietly beating the yaml is what this replaced.

/** `icons` with Material's defaults filled in. */
export type IconChoice = Required<IconsConfig>;

const envNames = {
  fill: "ICON_FILL",
  set: "ICON_SET",
  style: "ICON_STYLE",
  weight: "ICON_WEIGHT",
} as const satisfies Record<keyof IconsConfig, string>;

type Key = keyof typeof envNames;

const truthy = new Set(["1", "true", "yes"]);
const falsy = new Set(["0", "false", "no"]);

/** Converts an env string to the type the schema expects, where it can. */
function fromEnv(key: Key, raw: string): unknown {
  const value = raw.toLowerCase();
  if (key === "weight") {
    return Number(value);
  }
  if (key === "fill") {
    if (truthy.has(value)) {
      return true;
    }
    return falsy.has(value) ? false : value;
  }
  return value;
}

function overrides(env: Env): Partial<Record<Key, unknown>> {
  return Object.fromEntries(
    Object.entries(envNames).flatMap(([key, name]) => {
      const raw = env[name]?.trim();
      return raw ? [[key, fromEnv(key as Key, raw)]] : [];
    })
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The `ICON_*` variables with a value; a blank one (an unset build arg) isn't. */
export function iconEnvSet(env: Env): string[] {
  return Object.values(envNames).filter((name) => Boolean(env[name]?.trim()));
}

/**
 * Resolves the choice from the config file's `icons` block (`undefined` when
 * there is no file or no block) and the environment. A block, even an empty
 * one, wins outright; the variables are read only when there's none.
 */
export function resolveIconChoice(
  block: unknown,
  env: Env
): Result<IconChoice, string[]> {
  const interpolated = interpolateEnv(block ?? {}, env, ["icons"]);
  if (!isRecord(interpolated.value)) {
    return { error: ["icons: must be a mapping"], ok: false };
  }
  const envValues = block === undefined ? overrides(env) : {};
  const parsed = iconsSchema.safeParse({
    ...interpolated.value,
    ...envValues,
  });
  const problems = [
    ...interpolated.errors.map(
      (error) => `${error.path.join(".")}: ${error.message}`
    ),
    ...(parsed.success ? [] : parsed.error.issues).map((issue) => {
      const [key] = issue.path;
      const where =
        typeof key === "string" && key in envValues
          ? envNames[key as Key]
          : ["icons", ...issue.path.map(String)].join(".");
      return `${where}: ${issue.message}`;
    }),
  ];
  if (problems.length > 0 || !parsed.success) {
    return { error: problems, ok: false };
  }
  return {
    ok: true,
    value: {
      ...parsed.data,
      style: parsed.data.style ?? "outlined",
      weight: parsed.data.weight ?? 400,
    },
  };
}

/**
 * One line naming the `ICON_*` variables that override the defaults (there's
 * no block) or are ignored (a block decides); `undefined` when none is set.
 * `source` is the config file, when there is one. Names only, never values.
 */
export function iconEnvWarning(
  block: unknown,
  env: Env,
  source: string | undefined
): string | undefined {
  const names = iconEnvSet(env);
  if (names.length === 0) {
    return;
  }
  const list = names.join(", ");
  const one = names.length === 1;
  if (block !== undefined) {
    return `${list} ${one ? "is" : "are"} set but ignored: the icons block in ${source ?? "the config"} decides. Remove ${one ? "it" : "them"} from the environment; \`bun run setup\` offers to move ${one ? "it" : "them"} out of .env.`;
  }
  const where = source
    ? `${source} has no icons block`
    : "there's no app.config.yaml";
  return `${list} ${one ? "sets" : "set"} the icons because ${where}. That's meant for Docker build args; otherwise, choose in app.config.yaml's icons block.`;
}

/** `material (rounded, 300, filled)`, or just the set when it has no variants. */
export function describeChoice(choice: IconChoice): string {
  if (choice.set !== "material") {
    return choice.set;
  }
  const fill = choice.fill ? "filled" : "unfilled";
  return `material (${choice.style}, ${choice.weight}, ${fill})`;
}

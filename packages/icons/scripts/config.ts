import { type Env, interpolateEnv } from "@workspace/config/parse";
import { type IconsConfig, iconsSchema } from "@workspace/config/schema";

import type { Result } from "./registry";

// Which set (and Material variant) to build with (D19). The config's `icons`
// block decides; `ICON_*` variables override it, because a Docker image is
// built before its config is mounted and gets its set from build args.

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

/**
 * Resolves the choice from the config file's `icons` block (`undefined` when
 * there is no file or no block) and the environment. Blank variables don't
 * override, so an unset Docker build arg leaves the config in charge.
 */
export function resolveIconChoice(
  block: unknown,
  env: Env
): Result<IconChoice, string[]> {
  const interpolated = interpolateEnv(block ?? {}, env, ["icons"]);
  if (!isRecord(interpolated.value)) {
    return { error: ["icons: must be a mapping"], ok: false };
  }
  const envValues = overrides(env);
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

/** `material (rounded, 300, filled)`, or just the set when it has no variants. */
export function describeChoice(choice: IconChoice): string {
  if (choice.set !== "material") {
    return choice.set;
  }
  const fill = choice.fill ? "filled" : "unfilled";
  return `material (${choice.style}, ${choice.weight}, ${fill})`;
}

import { err, ok, type Result } from "@workspace/shared/result";
import { parseDocument } from "yaml";
import { z } from "zod";

import { type AppConfig, appConfigSchema } from "./schema";

// The pure core of config loading: text and an env map in, a typed config or
// every problem out. No file system, no `process.env`; `load.ts` is the shell.

export const configErrorSchema = z.object({
  /** 1-based line in the YAML, when the problem is a YAML syntax error. */
  line: z.int().min(1).optional(),
  /** Readable, and never contains a config value (values may be secrets). */
  message: z.string(),
  /** Where in the config, like `["providers", "openai", "baseURL"]`. */
  path: z.array(z.union([z.string(), z.int()])),
});
export type ConfigError = z.infer<typeof configErrorSchema>;

export type Env = Readonly<Record<string, string | undefined>>;

const ENV_NAME = "[A-Za-z_][A-Za-z0-9_]*";
/** `${NAME}` or `${NAME:-fallback}`; `$${` is a literal `${`. */
const REFERENCE = new RegExp(`\\$?\\$\\{(${ENV_NAME})(?::-([^}]*))?\\}`, "g");
const WHOLE_REFERENCE = new RegExp(`^\\$\\{(${ENV_NAME})(?::-([^}]*))?\\}$`);

type Path = (string | number)[];

/**
 * An MCP server's `headers` and `env` keep a key whose reference is unset,
 * as `undefined`, so the server can be marked unconfigured by name instead
 * of silently connecting without its credential (184).
 */
const keepsUnset = (path: Path): boolean =>
  path.length === 4 &&
  path[0] === "mcp" &&
  path[1] === "servers" &&
  (path[3] === "headers" || path[3] === "env");

/**
 * Replaces `${NAME}` references in string values. Values, not raw text, so an
 * env value can never inject YAML structure.
 *
 * - A value that is only a reference (`apiKey: ${OPENAI_API_KEY}`) and whose
 *   variable is unset or empty becomes absent, so the setting falls back to
 *   its default: a missing key disables a provider instead of failing boot.
 * - A reference inside a longer string must resolve (or have a `:-` default),
 *   because half a URL is never what anyone meant.
 */
export const interpolateEnv = (
  value: unknown,
  env: Env,
  path: Path = []
): { readonly errors: ConfigError[]; readonly value: unknown } => {
  if (typeof value === "string") {
    if (WHOLE_REFERENCE.test(value)) {
      const name = value.replace(WHOLE_REFERENCE, "$1");
      const fallback = value.replace(WHOLE_REFERENCE, "$2");
      return { errors: [], value: env[name] || fallback || undefined };
    }
    const errors: ConfigError[] = [];
    const replaced = value.replace(
      REFERENCE,
      (match, variable: string, fallback?: string) => {
        if (match.startsWith("$$")) {
          return match.slice(1);
        }
        const resolved = env[variable] || fallback;
        if (resolved === undefined) {
          errors.push({
            message: `environment variable ${variable} is not set (use \${${variable}:-default} for a fallback)`,
            path,
          });
          return "";
        }
        return resolved;
      }
    );
    return { errors, value: replaced };
  }
  if (Array.isArray(value)) {
    const results = value.map((item, index) =>
      interpolateEnv(item, env, [...path, index])
    );
    return {
      errors: results.flatMap((result) => result.errors),
      value: results.map((result) => result.value),
    };
  }
  if (value !== null && typeof value === "object") {
    const results = Object.entries(value).map(
      ([key, item]) => [key, interpolateEnv(item, env, [...path, key])] as const
    );
    return {
      errors: results.flatMap(([, result]) => result.errors),
      value: Object.fromEntries(
        results
          .filter(
            ([, result]) => result.value !== undefined || keepsUnset(path)
          )
          .map(([key, result]) => [key, result.value])
      ),
    };
  }
  return { errors: [], value };
};

const toConfigErrors = (error: z.ZodError): ConfigError[] =>
  error.issues.map((issue) => ({
    message: issue.message,
    path: issue.path.filter(
      (segment): segment is string | number => typeof segment !== "symbol"
    ),
  }));

/**
 * Parses `app.config.yaml` text against the schema, after `${ENV}`
 * interpolation. Empty text means "all defaults". Collects every problem
 * rather than stopping at the first, so one boot shows them all.
 */
export const parseConfig = (
  text: string,
  env: Env
): Result<AppConfig, ConfigError[]> => {
  const document = parseDocument(text);
  if (document.errors.length > 0) {
    return err(
      document.errors.map((error) => ({
        line: error.linePos?.[0]?.line,
        message: `YAML: ${error.message.split("\n")[0]}`,
        path: [],
      }))
    );
  }
  const raw: unknown = document.toJS() ?? {};
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return err([
      { message: "the config must be a mapping of sections", path: [] },
    ]);
  }
  const interpolated = interpolateEnv(raw, env);
  const parsed = appConfigSchema.safeParse(interpolated.value);
  const errors = [
    ...interpolated.errors,
    ...(parsed.success ? [] : toConfigErrors(parsed.error)),
  ];
  if (errors.length > 0 || !parsed.success) {
    return err(errors);
  }
  return ok(parsed.data);
};

/** `providers.openai.baseURL: Invalid URL`, one line per problem. */
export const formatConfigErrors = (
  errors: readonly ConfigError[],
  source = "app.config.yaml"
): string =>
  errors
    .map((error) => {
      const where = error.path.length > 0 ? error.path.join(".") : "(root)";
      const line = error.line ? `:${error.line}` : "";
      return `${source}${line}  ${where}: ${error.message}`;
    })
    .join("\n");

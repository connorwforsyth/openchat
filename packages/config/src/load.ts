import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { err, type Result } from "@workspace/shared/result";

import { type ConfigError, type Env, parseConfig } from "./parse";
import type { AppConfig } from "./schema";

// The imperative shell around `parseConfig`: finds the file and reads it.
// Called once at boot; changes apply on restart (D18).

export const DEFAULT_CONFIG_FILE = "app.config.yaml";

export interface LoadedConfig {
  readonly config: AppConfig;
  /** The file that was read, or `null` when none exists and defaults apply. */
  readonly source: string | null;
}

interface LoadOptions {
  readonly cwd?: string;
  readonly env?: Env;
  /** Injected for tests; defaults to the file system. */
  readonly readText?: (path: string) => Promise<string | undefined>;
}

const readIfExists = async (path: string): Promise<string | undefined> => {
  try {
    return await readFile(path, "utf8");
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }
    throw cause;
  }
};

/**
 * Loads `CONFIG_PATH`, or `app.config.yaml` in the working directory. With no
 * `CONFIG_PATH` and no file, every default applies, so a fresh checkout boots
 * with an empty env. A `CONFIG_PATH` that points nowhere is an error: someone
 * asked for a specific file and should hear that it's missing.
 */
export const loadConfig = async ({
  cwd = process.cwd(),
  env = process.env,
  readText = readIfExists,
}: LoadOptions = {}): Promise<Result<LoadedConfig, ConfigError[]>> => {
  const explicit = env.CONFIG_PATH?.trim();
  const path = resolve(cwd, explicit || DEFAULT_CONFIG_FILE);
  const text = await readText(path);
  if (text === undefined && explicit) {
    return err([
      {
        message: `CONFIG_PATH is set to ${path}, which doesn't exist`,
        path: [],
      },
    ]);
  }
  const parsed = parseConfig(text ?? "", env);
  return parsed.ok
    ? {
        ok: true,
        value: {
          config: parsed.value,
          source: text === undefined ? null : path,
        },
      }
    : parsed;
};

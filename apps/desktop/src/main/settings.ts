import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { z } from "zod";

import {
  DEFAULT_QUICK_SHORTCUT,
  quickShortcutSettingSchema,
} from "./quick-shortcut";
import { windowStateSchema } from "./window-state";

// What the shell remembers between launches, in its userData directory.
// Parsed on read: a hand-edited or older file falls back to defaults rather
// than crashing boot.

export const settingsSchema = z.object({
  instance: z
    .object({ name: z.string(), origin: z.url() })
    .nullable()
    .default(null),
  /**
   * Quick AI (118). `shortcut` is the global shortcut that opens it, in the
   * web app's notation (`Alt+Space`), or `null` for none. A value that
   * isn't a combo is kept as written, so main can say what's wrong with it.
   */
  quickAi: z
    .object({
      shortcut: quickShortcutSettingSchema.catch(DEFAULT_QUICK_SHORTCUT),
    })
    .catch({ shortcut: DEFAULT_QUICK_SHORTCUT })
    .default({ shortcut: DEFAULT_QUICK_SHORTCUT }),
  /** The main window's last bounds (117). An unreadable value is dropped, not fatal. */
  window: windowStateSchema.nullable().catch(null).default(null),
});
export type Settings = z.infer<typeof settingsSchema>;

const DEFAULTS: Settings = {
  instance: null,
  quickAi: { shortcut: DEFAULT_QUICK_SHORTCUT },
  window: null,
};

export const settingsPath = (userData: string): string =>
  join(userData, "settings.json");

export const readSettings = async (path: string): Promise<Settings> => {
  try {
    const parsed = settingsSchema.safeParse(
      JSON.parse(await readFile(path, "utf8"))
    );
    return parsed.success ? parsed.data : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
};

/** Writes through a temporary file, so a crash mid-write leaves the old file. */
export const writeSettings = async (
  path: string,
  settings: Settings
): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  await writeFile(
    temporary,
    `${JSON.stringify(settingsSchema.parse(settings), null, 2)}\n`
  );
  await rename(temporary, path);
};

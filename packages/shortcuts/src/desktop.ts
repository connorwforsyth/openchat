import { z } from "zod";

import { type ShortcutId, shortcutIdSchema } from "./ids";

// The desktop shell's bridge as the web app sees it (117). Inside the shell
// the page has `window.desktop` (apps/desktop/src/preload/instance.ts): the
// OS it runs on, the native menu's commands, which are shortcut ids, and
// (118) a way for the Quick AI page to put its window away. In a
// browser there's no bridge and all of this is inert. The bridge is parsed
// rather than trusted, so an older or newer shell degrades to "not in the
// shell" instead of throwing.

export const desktopPlatformSchema = z.enum(["mac", "win", "linux"]);
export type DesktopPlatform = z.infer<typeof desktopPlatformSchema>;

type Unsubscribe = () => void;

export interface DesktopBridge {
  /**
   * Hides the Quick AI window (118), when the page is in it; elsewhere the
   * shell ignores it. `null` from a shell older than Quick AI.
   */
  readonly hideQuickAi: (() => void) | null;
  readonly onMenuCommand: (
    listener: (command: ShortcutId) => void
  ) => Unsubscribe;
  readonly platform: DesktopPlatform;
}

const isFunction = (value: unknown) => typeof value === "function";

const bridgeSchema = z.object({
  hideQuickAi: z.custom<() => void>(isFunction).optional(),
  onMenuCommand:
    z.custom<(listener: (command: unknown) => void) => Unsubscribe>(isFunction),
  platform: desktopPlatformSchema,
});

/** The shell's bridge on `scope` (normally `window`), or `null` outside the shell. */
export const readDesktopBridge = (scope: object): DesktopBridge | null => {
  const parsed = bridgeSchema.safeParse(Reflect.get(scope, "desktop"));
  if (!parsed.success) {
    return null;
  }
  const bridge = parsed.data;
  const { hideQuickAi } = bridge;
  return {
    hideQuickAi: hideQuickAi ? () => hideQuickAi() : null,
    onMenuCommand: (listener) => {
      const unsubscribe = bridge.onMenuCommand((command) => {
        const id = shortcutIdSchema.safeParse(command);
        if (id.success) {
          listener(id.data);
        }
      });
      return typeof unsubscribe === "function" ? unsubscribe : noop;
    },
    platform: bridge.platform,
  };
};

const noop = () => undefined;

const currentScope = (): object =>
  typeof window === "undefined" ? {} : window;

/**
 * Runs `run` whenever the native menu sends `id`. Returns the unsubscribe; a
 * no-op outside the shell (and on the server).
 */
export const onDesktopMenuCommand = (
  id: ShortcutId,
  run: () => void,
  scope: object = currentScope()
): Unsubscribe => {
  const bridge = readDesktopBridge(scope);
  if (!bridge) {
    return noop;
  }
  return bridge.onMenuCommand((command) => {
    if (command === id) {
      run();
    }
  });
};

import { describe, expect, it, vi } from "vitest";

import { onDesktopMenuCommand, readDesktopBridge } from "./desktop";

/** A stand-in for the shell's preload bridge that the test drives. */
const fakeShell = (platform: unknown = "mac") => {
  const listeners = new Set<(command: unknown) => void>();
  return {
    desktop: {
      onMenuCommand(listener: (command: unknown) => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      platform,
    },
    listeners,
    send: (command: unknown) => {
      for (const listener of listeners) {
        listener(command);
      }
    },
  };
};

describe("readDesktopBridge", () => {
  it("is null in a browser", () => {
    expect(readDesktopBridge({})).toBeNull();
    expect(readDesktopBridge({ desktop: undefined })).toBeNull();
  });

  it("is null for a bridge it doesn't recognise", () => {
    expect(readDesktopBridge({ desktop: { platform: "mac" } })).toBeNull();
    expect(readDesktopBridge(fakeShell("beos"))).toBeNull();
  });

  it("reads the platform", () => {
    expect(readDesktopBridge(fakeShell("win"))?.platform).toBe("win");
  });

  it("offers hiding the Quick AI window where the shell has it", () => {
    expect(readDesktopBridge(fakeShell())?.hideQuickAi).toBeNull();
    const hideQuickAi = vi.fn();
    const shell = fakeShell();
    readDesktopBridge({
      desktop: { ...shell.desktop, hideQuickAi },
    })?.hideQuickAi?.();
    expect(hideQuickAi).toHaveBeenCalledOnce();
  });

  it("passes on registry ids only", () => {
    const shell = fakeShell();
    const listener = vi.fn();
    readDesktopBridge(shell)?.onMenuCommand(listener);
    shell.send("chat.new");
    shell.send("rm -rf");
    shell.send({ id: "chat.new" });
    expect(listener.mock.calls).toEqual([["chat.new"]]);
  });
});

describe("onDesktopMenuCommand", () => {
  it("runs for its own id until unsubscribed", () => {
    const shell = fakeShell();
    const run = vi.fn();
    const unsubscribe = onDesktopMenuCommand("sidebar.toggle", run, shell);
    shell.send("palette.open");
    shell.send("sidebar.toggle");
    expect(run).toHaveBeenCalledTimes(1);
    unsubscribe();
    shell.send("sidebar.toggle");
    expect(run).toHaveBeenCalledTimes(1);
    expect(shell.listeners.size).toBe(0);
  });

  it("is a no-op outside the shell", () => {
    expect(() => onDesktopMenuCommand("chat.new", vi.fn(), {})()).not.toThrow();
  });
});

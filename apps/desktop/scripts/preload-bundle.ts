import { runInNewContext } from "node:vm";

// Sandboxed preloads (D24) run without Node: `require` reaches only Electron's
// renderer modules and a few polyfilled built-ins, and a dynamic `import()`
// isn't available at all. A bundle that pulls in anything else fails when the
// window opens, which only the macOS smoke test would notice. This loads a
// built preload in a bare VM context with that same `require`, so a Linux CI
// run catches it (148, after T3 Code's verify-preload-bundle).

/** What a sandboxed preload may `require` (Electron's "Preload scripts" sandbox list). */
export const SANDBOX_MODULES = ["electron", "events", "timers", "url"] as const;

export type PreloadCheck =
  | { readonly ok: true; readonly exposed: Readonly<Record<string, string[]>> }
  | { readonly ok: false; readonly problems: readonly string[] };

const DYNAMIC_IMPORT = /\bimport\s*\(/;

const stubElectron = (exposed: Record<string, string[]>) => ({
  contextBridge: {
    exposeInMainWorld(key: string, api: Record<string, unknown>) {
      exposed[key] = Object.keys(api).sort();
    },
  },
  ipcRenderer: {
    invoke: () => Promise.resolve(undefined),
    on: () => undefined,
    removeListener: () => undefined,
    send: () => undefined,
  },
});

/** Runs one built preload the way a sandboxed renderer would and reports what it exposed. */
export const checkPreload = (
  source: string,
  platform: NodeJS.Platform = "darwin"
): PreloadCheck => {
  if (DYNAMIC_IMPORT.test(source)) {
    // Not run: the VM would reject the import asynchronously, after the check.
    return {
      ok: false,
      problems: ["uses a dynamic import(), which a sandboxed preload can't"],
    };
  }
  const problems: string[] = [];
  const exposed: Record<string, string[]> = {};
  const electron = stubElectron(exposed);
  const sandboxRequire = (id: string): unknown => {
    if (id === "electron") {
      return electron;
    }
    if ((SANDBOX_MODULES as readonly string[]).includes(id)) {
      return {};
    }
    throw new Error(`requires "${id}", which a sandboxed preload can't`);
  };
  const module = { exports: {} };
  try {
    runInNewContext(source, {
      exports: module.exports,
      module,
      process: { env: {}, platform },
      require: sandboxRequire,
    });
  } catch (error) {
    problems.push(error instanceof Error ? error.message : String(error));
  }
  return problems.length > 0 ? { ok: false, problems } : { exposed, ok: true };
};

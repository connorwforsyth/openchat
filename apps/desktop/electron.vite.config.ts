import { createRequire } from "node:module";
import { resolve } from "node:path";

import { getConfig } from "@lingui/conf";
import babel from "@rolldown/plugin-babel";
import { defineConfig } from "electron-vite";

const require = createRequire(import.meta.url);

// The one Lingui config lives in @workspace/i18n (one catalog for every app).
// Macros compile away at build time; Vite needs the Babel plugin for that.
const lingui = () =>
  babel({
    plugins: [
      [
        "@lingui/babel-plugin-lingui-macro",
        {
          linguiConfig: getConfig({
            configPath: require.resolve("@workspace/i18n/lingui.config"),
          }),
        },
      ],
    ],
  });

// Lingui's extraction scans every app, built output included, and reads a
// macro's leftover `/* i18n */` annotation or an `i18n._(…)` call as a use of
// the message. Without comments, and minified (as the page already is), a
// build doesn't change the catalog.
const output = { comments: false } as const;

// The shell is three bundles in dist/ (PLAN.md §6 "Build rules": the
// Electron main bundle compiles; dist/ is what Lingui's extraction, git and
// turbo already treat as output). Workspace packages are TypeScript source, so main and the
// preloads bundle their dependencies instead of loading them from
// node_modules at run time.
export default defineConfig({
  main: {
    build: {
      externalizeDeps: false,
      minify: true,
      outDir: "dist/main",
      rolldownOptions: { output },
    },
    plugins: [lingui()],
  },
  preload: {
    build: {
      // Sandboxed preloads (D24) can't `require` anything but a few Electron
      // modules, so each is one self-contained CommonJS file.
      externalizeDeps: false,
      isolatedEntries: true,
      outDir: "dist/preload",
      rolldownOptions: {
        input: {
          instance: resolve(import.meta.dirname, "src/preload/instance.ts"),
          setup: resolve(import.meta.dirname, "src/preload/setup.ts"),
        },
        output: { ...output, entryFileNames: "[name].cjs", format: "cjs" },
      },
    },
  },
  // The only local page: the first-run screen that asks for the instance.
  renderer: {
    build: {
      outDir: "dist/renderer",
      rolldownOptions: {
        // Shared components carry Next's "use client"; a Vite page has no
        // server components, so the directive is noise here.
        onLog(level, log, handler) {
          if (log.code !== "MODULE_LEVEL_DIRECTIVE") {
            handler(level, log);
          }
        },
        output,
      },
    },
    plugins: [lingui()],
  },
});

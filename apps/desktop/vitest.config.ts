import { createRequire } from "node:module";

import { getConfig } from "@lingui/conf";
import babel from "@rolldown/plugin-babel";
import { defineProject } from "vitest/config";

const require = createRequire(import.meta.url);

// The shell's pure core (URLs, navigation and permission rules, settings,
// the instance check, the menu) runs in Node. The Electron wiring is covered
// by the smoke test in e2e/desktop.
export default defineProject({
  plugins: [
    // The menu's labels are Lingui macros, as in the build.
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
    }),
  ],
  test: {
    hookTimeout: 60_000,
    include: ["src/**/*.test.ts"],
    name: "desktop",
    // Loaded CI runners are several times slower than a laptop (ticket 035).
    testTimeout: 30_000,
  },
});

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { linguiMacroSwcPlugin } from "@lingui/swc-plugin/options";
import type { NextConfig } from "next";

const require = createRequire(import.meta.url);

// `NEXT_OUTPUT=standalone` is set only by apps/web/Dockerfile: the image
// ships `.next/standalone` (a traced, self-contained server) rather than the
// workspace's node_modules. `bun dev` and `next start` keep the default.
const standalone = process.env.NEXT_OUTPUT === "standalone";

const nextConfig: NextConfig = {
  experimental: {
    // Lingui macros (`<Trans>`, `t`) compile away at build time. The config
    // lives in @workspace/i18n because one catalog serves every app.
    swcPlugins: [
      linguiMacroSwcPlugin(undefined, {
        configPath: require.resolve("@workspace/i18n/lingui.config"),
      }),
    ],
  },
  ...(standalone
    ? {
        output: "standalone" as const,
        // Trace from the monorepo root: the server imports workspace packages.
        // (The migrations it reads at boot are copied in by the Dockerfile.)
        outputFileTracingRoot: fileURLToPath(new URL("../..", import.meta.url)),
      }
    : {}),
  // PGlite loads its WASM and extension bundles from files beside its own
  // code; bundled, it can't (`instantiateWasm is not a function`), so the
  // server requires it from node_modules instead.
  serverExternalPackages: [
    "@electric-sql/pglite",
    "@electric-sql/pglite-pgvector",
  ],
  transpilePackages: ["@workspace/i18n", "@workspace/icons", "@workspace/ui"],
};

export default nextConfig;

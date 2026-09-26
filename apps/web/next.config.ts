import { createRequire } from "node:module";

import { linguiMacroSwcPlugin } from "@lingui/swc-plugin/options";
import type { NextConfig } from "next";

const require = createRequire(import.meta.url);

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
  transpilePackages: ["@workspace/i18n", "@workspace/icons", "@workspace/ui"],
};

export default nextConfig;

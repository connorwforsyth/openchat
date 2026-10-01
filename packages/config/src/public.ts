import {
  featureFlagSchema,
  type PublicConfig,
} from "@workspace/contract/schemas/meta";
import type { SandboxProvider } from "@workspace/contract/schemas/sandbox";

import type { Env } from "./parse";
import type { AppConfig } from "./schema";
import { enabledSocialProviders, socialProviderNames } from "./social";

// The slice of config any client may read (`GET /config`). Built here so the
// rule "no secrets, no internal URLs" lives next to the schema that has them.

/** Sandbox providers that are configured enough to try. `local` is desktop-only. */
export const availableSandboxProviders = (
  config: AppConfig
): SandboxProvider[] => {
  if (!config.features.sandboxes || config.sandbox.default === "none") {
    return [];
  }
  const { sandbox } = config;
  const candidates: [SandboxProvider, boolean][] = [
    ["just-bash", true],
    ["docker", sandbox.docker !== undefined],
    ["e2b", sandbox.e2b?.apiKey !== undefined],
    ["vercel", sandbox.vercel?.token !== undefined],
    ["microsandbox", sandbox.microsandbox !== undefined],
  ];
  return candidates.filter(([, ok]) => ok).map(([provider]) => provider);
};

/**
 * `env` is where environment-only social sign-in comes from
 * (`GITHUB_CLIENT_ID` and friends); pass `process.env` at the shell.
 */
export const toPublicConfig = (
  config: AppConfig,
  env: Env = {}
): PublicConfig => {
  const sandboxProviders = availableSandboxProviders(config);
  const { sandbox } = config;
  return {
    auth: {
      providers: [
        ...config.auth.oidc.map(({ id, name }) => ({ id, name })),
        ...enabledSocialProviders(config, env).map((id) => ({
          id,
          name: socialProviderNames[id],
        })),
      ],
      signup: config.auth.signup,
    },
    brand: {
      faviconUrl: config.brand.favicon,
      logoUrl: config.brand.logo,
      name: config.brand.name,
    },
    // The public flags only: `linkPreviews` is server-side (101), and the
    // contract's record takes exactly the public ones.
    features: Object.fromEntries(
      featureFlagSchema.options.map((flag) => [flag, config.features[flag]])
    ) as PublicConfig["features"],
    limits: {
      memoryMaxChars: config.limits.memoryMaxChars,
      uploadMaxMb: config.limits.uploadMaxMb,
    },
    policies: { chatContexts: config.policies.chatContext },
    sandbox: {
      default:
        sandbox.default !== "none" && sandboxProviders.includes(sandbox.default)
          ? sandbox.default
          : null,
      providers: sandboxProviders,
    },
  };
};

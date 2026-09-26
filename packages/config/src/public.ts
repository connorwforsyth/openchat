import type { PublicConfig } from "@workspace/contract/schemas/meta";
import type { SandboxProvider } from "@workspace/contract/schemas/sandbox";

import type { AppConfig } from "./schema";

// The slice of config any client may read (`GET /config`). Built here so the
// rule "no secrets, no internal URLs" lives next to the schema that has them.

const socialNames = { github: "GitHub", google: "Google" } as const;

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

export const toPublicConfig = (config: AppConfig): PublicConfig => {
  const sandboxProviders = availableSandboxProviders(config);
  const { sandbox } = config;
  return {
    auth: {
      providers: [
        ...config.auth.oidc.map(({ id, name }) => ({ id, name })),
        ...(["github", "google"] as const)
          .filter((id) => config.auth.social[id])
          .map((id) => ({ id, name: socialNames[id] })),
      ],
      signup: config.auth.signup,
    },
    brand: {
      faviconUrl: config.brand.favicon,
      logoUrl: config.brand.logo,
      name: config.brand.name,
    },
    features: config.features,
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

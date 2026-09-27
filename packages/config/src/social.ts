import type { AppConfig } from "./schema";

// GitHub and Google sign-in (D22, owner question 17). Credentials come from
// `auth.social` in app.config.yaml, else from the conventional environment
// variables, so `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET` alone switch GitHub
// on. Half a pair is none. The auth server and the public config must agree
// on which buttons exist, so both read this.

export const socialProviderIds = ["github", "google"] as const;
export type SocialProviderId = (typeof socialProviderIds)[number];

export const socialProviderNames: Readonly<Record<SocialProviderId, string>> = {
  github: "GitHub",
  google: "Google",
};

export interface SocialCredentials {
  readonly clientId: string;
  readonly clientSecret: string;
}

const ENV_NAMES: Readonly<
  Record<SocialProviderId, readonly [id: string, secret: string]>
> = {
  github: ["GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET"],
  google: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
};

export const socialCredentials = (
  config: AppConfig,
  env: Readonly<Record<string, string | undefined>>,
  provider: SocialProviderId
): SocialCredentials | undefined => {
  const fromConfig = config.auth.social[provider];
  if (fromConfig) {
    return fromConfig;
  }
  const [idName, secretName] = ENV_NAMES[provider];
  const clientId = env[idName]?.trim();
  const clientSecret = env[secretName]?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : undefined;
};

/** Social providers with a full pair of credentials, in button order. */
export const enabledSocialProviders = (
  config: AppConfig,
  env: Readonly<Record<string, string | undefined>>
): readonly SocialProviderId[] =>
  socialProviderIds.filter(
    (provider) => socialCredentials(config, env, provider) !== undefined
  );

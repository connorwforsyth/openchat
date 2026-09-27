"use client";

import { Trans } from "@lingui/react/macro";
import type { PublicConfig } from "@workspace/contract/schemas/meta";
import { Button } from "@workspace/ui/components/button";
import { FieldSeparator } from "@workspace/ui/components/field";
import { useCallback, useState } from "react";

import { type AuthProblem, authProblemOf } from "./auth-errors";
import { AuthProblemMessage } from "./auth-problem";
import { useAuthClient } from "./use-auth-client";

type Provider = PublicConfig["auth"]["providers"][number];

const ProviderButton = ({
  disabled,
  onStart,
  provider,
}: {
  readonly disabled: boolean;
  readonly onStart: (provider: Provider) => Promise<void>;
  readonly provider: Provider;
}) => {
  const onClick = useCallback(() => {
    onStart(provider).catch(() => undefined);
  }, [onStart, provider]);
  const { name } = provider;
  return (
    <Button
      disabled={disabled}
      onClick={onClick}
      type="button"
      variant="outline"
    >
      <Trans>Continue with {name}</Trans>
    </Button>
  );
};

/**
 * GitHub, Google and OIDC providers from public config. OIDC providers are
 * registered as social ones on the server, so one call covers all of them.
 */
export function SocialButtons({
  callbackUrl,
  providers,
  separator = true,
}: {
  readonly callbackUrl: string;
  readonly providers: readonly Provider[];
  /** "or" under the buttons, when a password form follows. */
  readonly separator?: boolean;
}) {
  const auth = useAuthClient();
  const [pending, setPending] = useState<string | null>(null);
  const [problem, setProblem] = useState<AuthProblem | null>(null);
  const start = useCallback(
    async (provider: Provider) => {
      setPending(provider.id);
      setProblem(null);
      // On success the browser leaves for the provider; only failures return.
      const result = await auth.signIn
        .social({ callbackURL: callbackUrl, provider: provider.id })
        .catch((error: unknown) => ({ error }));
      if (result.error) {
        setProblem(authProblemOf(result.error));
        setPending(null);
      }
    },
    [auth, callbackUrl]
  );
  if (providers.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-col gap-3">
      {providers.map((provider) => (
        <ProviderButton
          disabled={pending !== null}
          key={provider.id}
          onStart={start}
          provider={provider}
        />
      ))}
      <AuthProblemMessage problem={problem} />
      {separator ? (
        <FieldSeparator>
          <Trans>or</Trans>
        </FieldSeparator>
      ) : null}
    </div>
  );
}

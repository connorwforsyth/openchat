"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@workspace/ui/components/button";
import { Field, FieldGroup, FieldLabel } from "@workspace/ui/components/field";
import { Input } from "@workspace/ui/components/input";
import { Spinner } from "@workspace/ui/components/spinner";
import { type FormEvent, useCallback, useState } from "react";
import { z } from "zod";

import { type AuthProblem, authProblemOf } from "./auth-errors";
import { AuthProblemMessage } from "./auth-problem";
import { useAuthClient } from "./use-auth-client";

const credentialsSchema = z.object({
  email: z.string().trim().min(1),
  password: z.string().min(1),
});

/** Email and password. Where it lands is the page's `next`, already made safe. */
export function SignInForm({
  appUrl,
  next,
}: {
  /** The configured origin, for the message when this one isn't trusted. */
  readonly appUrl?: string;
  readonly next: string;
}) {
  const { t } = useLingui();
  const auth = useAuthClient();
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<AuthProblem | null>(null);

  const submit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const parsed = credentialsSchema.safeParse(
        Object.fromEntries(new FormData(event.currentTarget))
      );
      if (!parsed.success) {
        setProblem("wrong_credentials");
        return;
      }
      setPending(true);
      setProblem(null);
      const result = await auth.signIn
        .email(parsed.data)
        .catch((error: unknown) => ({ error }));
      if (result.error) {
        setProblem(authProblemOf(result.error));
        setPending(false);
        return;
      }
      // A full load, so the server renders the app with the new session.
      window.location.assign(next);
    },
    [auth, next]
  );

  const onSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      submit(event).catch(() => setPending(false));
    },
    [submit]
  );

  return (
    <form onSubmit={onSubmit}>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="sign-in-email">
            <Trans>Email</Trans>
          </FieldLabel>
          <Input
            autoComplete="email"
            id="sign-in-email"
            name="email"
            placeholder={t`name@example.com`}
            required
            type="email"
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="sign-in-password">
            <Trans>Password</Trans>
          </FieldLabel>
          <Input
            autoComplete="current-password"
            id="sign-in-password"
            name="password"
            required
            type="password"
          />
        </Field>
        <AuthProblemMessage appUrl={appUrl} problem={problem} />
        <Button disabled={pending} type="submit">
          {pending ? <Spinner data-icon="inline-start" /> : null}
          <Trans>Sign in</Trans>
        </Button>
      </FieldGroup>
    </form>
  );
}

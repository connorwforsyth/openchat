"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@workspace/ui/components/button";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@workspace/ui/components/field";
import { Input } from "@workspace/ui/components/input";
import { Spinner } from "@workspace/ui/components/spinner";
import { type FormEvent, useCallback, useState } from "react";
import { z } from "zod";

import { type AuthProblem, authProblemOf } from "./auth-errors";
import { AuthProblemMessage } from "./auth-problem";
import { useAuthClient } from "./use-auth-client";

/** Better Auth's default minimum; the server checks it again. */
export const MIN_PASSWORD_LENGTH = 8;

const signUpSchema = z.object({
  email: z.string().trim().min(1),
  name: z.string().trim().min(1).max(200),
  password: z.string().min(MIN_PASSWORD_LENGTH),
});

/**
 * A new account with a password. Whether it's allowed (first user, invite,
 * domain) is the server's decision (D22); a refusal comes back as a reason.
 */
export function SignUpForm({
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
      const parsed = signUpSchema.safeParse(
        Object.fromEntries(new FormData(event.currentTarget))
      );
      if (!parsed.success) {
        setProblem("weak_password");
        return;
      }
      setPending(true);
      setProblem(null);
      const result = await auth.signUp
        .email(parsed.data)
        .catch((error: unknown) => ({ error }));
      if (result.error) {
        setProblem(authProblemOf(result.error));
        setPending(false);
        return;
      }
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
          <FieldLabel htmlFor="sign-up-name">
            <Trans>Name</Trans>
          </FieldLabel>
          <Input autoComplete="name" id="sign-up-name" name="name" required />
        </Field>
        <Field>
          <FieldLabel htmlFor="sign-up-email">
            <Trans>Email</Trans>
          </FieldLabel>
          <Input
            autoComplete="email"
            id="sign-up-email"
            name="email"
            placeholder={t`name@example.com`}
            required
            type="email"
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="sign-up-password">
            <Trans>Password</Trans>
          </FieldLabel>
          <Input
            autoComplete="new-password"
            id="sign-up-password"
            minLength={MIN_PASSWORD_LENGTH}
            name="password"
            required
            type="password"
          />
          <FieldDescription>
            <Trans>At least 8 characters.</Trans>
          </FieldDescription>
        </Field>
        <AuthProblemMessage appUrl={appUrl} problem={problem} />
        <Button disabled={pending} type="submit">
          {pending ? <Spinner data-icon="inline-start" /> : null}
          <Trans>Create account</Trans>
        </Button>
      </FieldGroup>
    </form>
  );
}

import { Trans } from "@lingui/react/macro";
import { FieldError } from "@workspace/ui/components/field";

import type { AuthProblem } from "./auth-errors";

/** This page on the configured origin, so the link lands on the same form. */
const hereOn = (appUrl: string): string => {
  const { hash, pathname, search } = window.location;
  return new URL(`${pathname}${search}${hash}`, appUrl).href;
};

/**
 * The page was opened on an address the server doesn't trust (054). The
 * configured one is where it works; without one, only an admin can help.
 */
const OriginRejected = ({ appUrl }: { readonly appUrl?: string }) =>
  appUrl ? (
    <Trans>
      This address isn't allowed to sign in. Open{" "}
      <a className="underline underline-offset-4" href={hereOn(appUrl)}>
        {appUrl}
      </a>{" "}
      instead.
    </Trans>
  ) : (
    <Trans>
      This address isn't allowed to sign in. Use the address your administrator
      gave you, or ask them to add this one to the server's trusted origins.
    </Trans>
  );

const Message = ({
  appUrl,
  problem,
}: {
  readonly appUrl?: string;
  readonly problem: AuthProblem;
}) => {
  switch (problem) {
    case "wrong_credentials":
      return <Trans>That email and password don't match an account.</Trans>;
    case "email_taken":
      return (
        <Trans>
          There's already an account with that email. Sign in instead.
        </Trans>
      );
    case "weak_password":
      return <Trans>Choose a longer password (at least 8 characters).</Trans>;
    case "invite_required":
      return (
        <Trans>
          This server is invite-only. Use the invitation link you were sent,
          with the email address it was sent to.
        </Trans>
      );
    case "domain_not_allowed":
      return (
        <Trans>
          Accounts on this server are for approved email domains. Ask an
          administrator for an invitation.
        </Trans>
      );
    case "sso_required":
      return (
        <Trans>This server signs people in with single sign-on only.</Trans>
      );
    case "invalid_email":
      return <Trans>Enter a valid email address.</Trans>;
    case "password_too_long":
      return <Trans>That password is too long. Choose a shorter one.</Trans>;
    case "origin_rejected":
      return <OriginRejected appUrl={appUrl} />;
    case "rate_limited":
      return (
        <Trans>Too many attempts. Wait a few seconds and try again.</Trans>
      );
    case "unreachable":
      return (
        <Trans>
          Couldn't reach the server. Check your connection and try again.
        </Trans>
      );
    case "server_error":
      return (
        <Trans>
          The server couldn't finish that. Try again in a moment; if it keeps
          happening, an administrator can check the server's log.
        </Trans>
      );
    case "unavailable":
      return (
        <Trans>
          Sign-in isn't available on this server right now. An administrator
          needs to finish setting it up.
        </Trans>
      );
    case "failed":
      return <Trans>Something went wrong. Try again.</Trans>;
    default:
      return problem satisfies never;
  }
};

/**
 * A sign-in or sign-up failure, announced to screen readers. `appUrl` is the
 * configured origin (`BETTER_AUTH_URL`), named when the page's isn't trusted.
 */
export const AuthProblemMessage = ({
  appUrl,
  problem,
}: {
  readonly appUrl?: string;
  readonly problem: AuthProblem | null;
}) =>
  problem ? (
    <FieldError>
      <Message appUrl={appUrl} problem={problem} />
    </FieldError>
  ) : null;

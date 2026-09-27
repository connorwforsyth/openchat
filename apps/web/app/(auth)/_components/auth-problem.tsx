import { Trans } from "@lingui/react/macro";
import { FieldError } from "@workspace/ui/components/field";

import type { AuthProblem } from "./auth-errors";

const Message = ({ problem }: { readonly problem: AuthProblem }) => {
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

/** A sign-in or sign-up failure, announced to screen readers. */
export const AuthProblemMessage = ({
  problem,
}: {
  readonly problem: AuthProblem | null;
}) =>
  problem ? (
    <FieldError>
      <Message problem={problem} />
    </FieldError>
  ) : null;

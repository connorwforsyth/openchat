import { Trans } from "@lingui/react/macro";
import { invitationIdSchema } from "@workspace/contract/schemas/common";
import { invitationTokenSchema } from "@workspace/contract/schemas/tenancy";
import { initLingui } from "@workspace/i18n/server";
import { buttonVariants } from "@workspace/ui/components/button";
import Link from "next/link";

import { requestLocale } from "@/lib/i18n";
import { routes } from "@/lib/routes";
import { getViewer } from "@/lib/server-session";

import {
  AcceptInvite,
  type AcceptInviteInput,
} from "../../_components/accept-invite";
import { AuthCard } from "../../_components/auth-card";

// An invitation link. Signed out, it offers to create the account (or sign
// in) and comes back here; signed in, it accepts for the current account.
// The API checks that the invitation is for this account's email.

/**
 * What the link carries: the one-time token (042), or an invitation id from
 * a link made before tokens (deprecated for one release). A UUID also fits
 * the token's alphabet, so the id is checked first.
 */
const acceptInputOf = (segment: string): AcceptInviteInput | null => {
  const id = invitationIdSchema.safeParse(segment);
  if (id.success) {
    return { id: id.data };
  }
  const token = invitationTokenSchema.safeParse(segment);
  return token.success ? { token: token.data } : null;
};

export default async function InvitePage({
  params,
}: {
  readonly params: Promise<{ token: string }>;
}) {
  initLingui(await requestLocale());
  const { token } = await params;
  const accept = acceptInputOf(token);
  if (!accept) {
    return (
      <AuthCard
        description={
          <Trans>
            Check that you copied the whole link, or ask for a new one.
          </Trans>
        }
        title={<Trans>This invitation link isn't valid</Trans>}
      >
        <Link
          className={buttonVariants({ variant: "outline" })}
          href={routes.signIn}
        >
          <Trans>Go to sign in</Trans>
        </Link>
      </AuthCard>
    );
  }
  const viewer = await getViewer();
  const here = routes.invite(token);
  return (
    <AuthCard
      description={
        viewer.kind === "signed_in" ? (
          <Trans>
            You're signed in as {viewer.me.user.email}. Accept to join the team
            that invited you.
          </Trans>
        ) : (
          <Trans>
            Create an account with the email address the invitation was sent to,
            or sign in if you already have one.
          </Trans>
        )
      }
      title={<Trans>You've been invited</Trans>}
    >
      {viewer.kind === "signed_in" ? (
        <AcceptInvite input={accept} />
      ) : (
        <div className="flex flex-col gap-3">
          <Link
            className={buttonVariants()}
            href={routes.signUpForInvite(token)}
          >
            <Trans>Create account</Trans>
          </Link>
          <Link
            className={buttonVariants({ variant: "outline" })}
            href={routes.signInThen(here)}
          >
            <Trans>Sign in</Trans>
          </Link>
        </div>
      )}
    </AuthCard>
  );
}

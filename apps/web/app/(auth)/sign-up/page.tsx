import { Trans } from "@lingui/react/macro";
import { appOriginOf } from "@workspace/auth/env";
import type { SignupMode } from "@workspace/contract/schemas/meta";
import { initLingui } from "@workspace/i18n/server";
import Link from "next/link";
import { redirect } from "next/navigation";

import { requestLocale } from "@/lib/i18n";
import { getPublicConfig } from "@/lib/public-config";
import { routeParams, routes } from "@/lib/routes";
import { getViewer } from "@/lib/server-session";

import { AuthCard } from "../_components/auth-card";
import { firstParam, type SearchParams } from "../_components/search-params";
import { SignUpForm } from "../_components/sign-up-form";
import { SocialButtons } from "../_components/social-buttons";

// Who may sign up is the server's call (D22: the first user becomes admin,
// then invite-only unless config says otherwise); this page explains the
// mode and shows the server's reason when it refuses.

const ModeHint = ({
  invited,
  mode,
}: {
  readonly invited: boolean;
  readonly mode: SignupMode;
}) => {
  if (invited) {
    return (
      <Trans>
        Create your account with the email address the invitation was sent to.
      </Trans>
    );
  }
  switch (mode) {
    case "invite":
      return (
        <Trans>
          The first account on a new server becomes its administrator. After
          that, you need an invitation.
        </Trans>
      );
    case "domain":
      return <Trans>Use an email address from an approved domain.</Trans>;
    case "open":
    case "sso":
      return null;
    default:
      return mode satisfies never;
  }
};

const SsoOnly = ({ configured }: { readonly configured: boolean }) =>
  configured ? null : (
    <p className="text-muted-foreground text-sm">
      <Trans>
        This server signs people in with single sign-on, and none is set up yet.
      </Trans>
    </p>
  );

export default async function SignUpPage({
  searchParams,
}: {
  readonly searchParams: SearchParams;
}) {
  initLingui(await requestLocale());
  const invite = firstParam((await searchParams)[routeParams.invite]);
  // After an invited sign-up, back to the invitation to accept it.
  const next = invite ? routes.invite(invite) : routes.home;
  const [config, viewer] = await Promise.all([getPublicConfig(), getViewer()]);
  if (viewer.kind === "signed_in") {
    redirect(next);
  }
  const mode: SignupMode = config.ok ? config.config.auth.signup : "invite";
  const providers = config.ok ? config.config.auth.providers : [];
  // Named when this page's own address isn't trusted (054). It's the public
  // address, not a secret, so it can reach the browser.
  const appUrl = appOriginOf(process.env.BETTER_AUTH_URL);
  return (
    <AuthCard
      description={<ModeHint invited={invite !== undefined} mode={mode} />}
      footer={
        <Trans>
          Already have an account?{" "}
          <Link
            className="underline underline-offset-4"
            href={invite ? routes.signInThen(next) : routes.signIn}
          >
            Sign in
          </Link>
        </Trans>
      }
      title={<Trans>Create an account</Trans>}
    >
      <div className="flex flex-col gap-4">
        <SocialButtons
          appUrl={appUrl}
          callbackUrl={next}
          providers={providers}
          separator={mode !== "sso"}
        />
        {mode === "sso" ? (
          <SsoOnly configured={providers.length > 0} />
        ) : (
          <SignUpForm appUrl={appUrl} next={next} />
        )}
      </div>
    </AuthCard>
  );
}

import { Trans } from "@lingui/react/macro";
import { initLingui } from "@workspace/i18n/server";
import Link from "next/link";
import { redirect } from "next/navigation";

import { requestLocale } from "@/lib/i18n";
import { getPublicConfig } from "@/lib/public-config";
import { routeParams, routes, safeNext } from "@/lib/routes";
import { getViewer } from "@/lib/server-session";

import { AuthCard } from "../_components/auth-card";
import { firstParam, type SearchParams } from "../_components/search-params";
import { SignInForm } from "../_components/sign-in-form";
import { SocialButtons } from "../_components/social-buttons";

export default async function SignInPage({
  searchParams,
}: {
  readonly searchParams: SearchParams;
}) {
  initLingui(await requestLocale());
  const next = safeNext(firstParam((await searchParams)[routeParams.next]));
  const [config, viewer] = await Promise.all([getPublicConfig(), getViewer()]);
  if (viewer.kind === "signed_in") {
    redirect(next);
  }
  const providers = config.ok ? config.config.auth.providers : [];
  const ssoOnly = config.ok && config.config.auth.signup === "sso";
  return (
    <AuthCard
      footer={
        ssoOnly ? null : (
          <Trans>
            New here?{" "}
            <Link className="underline underline-offset-4" href={routes.signUp}>
              Create an account
            </Link>
          </Trans>
        )
      }
      title={<Trans>Sign in</Trans>}
    >
      <div className="flex flex-col gap-4">
        <SocialButtons
          callbackUrl={next}
          providers={providers}
          separator={!ssoOnly}
        />
        {/* SSO-only instances still let existing password accounts (the
            first admin) in; they just can't create new ones. */}
        <SignInForm next={next} />
      </div>
    </AuthCard>
  );
}

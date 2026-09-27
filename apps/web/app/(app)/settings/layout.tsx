import { msg } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { initLingui } from "@workspace/i18n/server";
import {
  BrainIcon,
  KeyboardIcon,
  KeyRoundIcon,
  PaletteIcon,
  ShieldIcon,
  UserIcon,
} from "@workspace/icons";
import type { ReactNode } from "react";

import { requestLocale } from "@/lib/i18n";

import { routes } from "../_shared/routes";
import { SectionLayout } from "../_shared/section-layout";

export default async function SettingsLayout({
  children,
}: {
  readonly children: ReactNode;
}) {
  const i18n = initLingui(await requestLocale());
  return (
    <SectionLayout
      heading={<Trans>Settings</Trans>}
      items={[
        {
          href: routes.settings("profile"),
          icon: <UserIcon />,
          label: <Trans>Profile and language</Trans>,
        },
        {
          href: routes.settings("keys"),
          icon: <KeyRoundIcon />,
          label: <Trans>Provider keys</Trans>,
        },
        {
          href: routes.settings("memory"),
          icon: <BrainIcon />,
          label: <Trans>Memory</Trans>,
        },
        {
          href: routes.settings("shortcuts"),
          icon: <KeyboardIcon />,
          label: <Trans>Shortcuts</Trans>,
        },
        {
          href: routes.settings("appearance"),
          icon: <PaletteIcon />,
          label: <Trans>Appearance</Trans>,
        },
        {
          href: routes.admin,
          icon: <ShieldIcon />,
          label: <Trans>Admin</Trans>,
        },
      ]}
      navLabel={i18n._(msg`Settings pages`)}
    >
      {children}
    </SectionLayout>
  );
}

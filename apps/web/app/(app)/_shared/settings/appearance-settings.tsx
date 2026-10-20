"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import { sidebarLayoutSchema } from "@workspace/chat-ui/shell/sidebar-layout";
import { MonitorIcon, MoonIcon, SunIcon } from "@workspace/icons";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@workspace/ui/components/toggle-group";
import { useTheme } from "next-themes";
import { useCallback, useSyncExternalStore } from "react";
import { z } from "zod";

import { useAppFrame } from "@/app/(app)/_shared/app-frame";

// Appearance: light, dark or follow the system. next-themes keeps the choice
// in this browser and applies it before paint; `D` toggles it anywhere.

const themeSchema = z.enum(["light", "dark", "system"]);

const subscribeNever = () => () => undefined;
const isClient = () => true;
const isServer = () => false;

/** Rail (181, the format going forward) or the classic single sidebar. */
const SidebarLayoutSetting = () => {
  const { setSidebarLayout, sidebarLayout } = useAppFrame();
  const onChange = useCallback(
    (values: readonly string[]) => {
      const next = sidebarLayoutSchema.safeParse(values[0]);
      if (next.success) {
        setSidebarLayout(next.data);
      }
    },
    [setSidebarLayout]
  );
  return (
    <div className="flex flex-col gap-2">
      <p className="font-medium text-sm" id="sidebar-layout-label">
        <Trans>Sidebar layout</Trans>
      </p>
      <ToggleGroup
        aria-labelledby="sidebar-layout-label"
        onValueChange={onChange}
        value={[sidebarLayout]}
        variant="outline"
      >
        <ToggleGroupItem value="rail">
          <Trans>Rail (recommended)</Trans>
        </ToggleGroupItem>
        <ToggleGroupItem value="classic">
          <Trans>Classic</Trans>
        </ToggleGroupItem>
      </ToggleGroup>
      <p className="text-muted-foreground text-sm">
        <Trans>
          Rail keeps an icon bar beside the chat list. Classic puts everything
          in one sidebar that hides when collapsed.
        </Trans>
      </p>
    </div>
  );
};

const ThemeSetting = () => {
  const { t } = useLingui();
  const { setTheme, theme } = useTheme();
  // The theme is only known in the browser; render no selection until then.
  const mounted = useSyncExternalStore<boolean>(
    subscribeNever,
    isClient,
    isServer
  );
  const selected = themeSchema.safeParse(theme);
  const onChange = useCallback(
    (values: readonly string[]) => {
      const next = themeSchema.safeParse(values[0]);
      if (next.success) {
        setTheme(next.data);
      }
    },
    [setTheme]
  );
  return (
    <div className="flex flex-col gap-2">
      <p className="font-medium text-sm" id="theme-label">
        <Trans>Theme</Trans>
      </p>
      <ToggleGroup
        aria-labelledby="theme-label"
        onValueChange={onChange}
        // biome-ignore lint/suspicious/noUnnecessaryConditions: false on the server snapshot; Biome only sees the client getter.
        value={mounted && selected.success ? [selected.data] : []}
        variant="outline"
      >
        <ToggleGroupItem aria-label={t`Light`} value="light">
          <SunIcon />
          <Trans>Light</Trans>
        </ToggleGroupItem>
        <ToggleGroupItem aria-label={t`Dark`} value="dark">
          <MoonIcon />
          <Trans>Dark</Trans>
        </ToggleGroupItem>
        <ToggleGroupItem aria-label={t`System`} value="system">
          <MonitorIcon />
          <Trans>System</Trans>
        </ToggleGroupItem>
      </ToggleGroup>
      <p className="text-muted-foreground text-sm">
        <Trans>The theme is saved in this browser.</Trans>
      </p>
    </div>
  );
};

export const AppearanceSettings = () => (
  <div className="flex flex-col gap-6">
    <ThemeSetting />
    <SidebarLayoutSetting />
  </div>
);

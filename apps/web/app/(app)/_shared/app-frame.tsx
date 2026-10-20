"use client";

import { Trans } from "@lingui/react/macro";
import { QueryClient, useQuery } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createWebAuthClient } from "@workspace/auth/client";
import {
  type ShellLayoutState,
  useShellLayout,
} from "@workspace/chat-ui/shell/use-shell-layout";
import {
  type Theme,
  themeSchema,
} from "@workspace/chat-ui/sidebar/account-menu";
import { createApiClient, createQueryUtils } from "@workspace/client/api";
import type { Me, PublicConfig } from "@workspace/contract/schemas/meta";
import type { RunTarget } from "@workspace/contract/schemas/runs";
import type { ChatContext, Org } from "@workspace/contract/schemas/tenancy";
import { CircleAlertIcon } from "@workspace/icons";
import type { PaletteContext } from "@workspace/palette/context-actions";
import { createSettingsOverridesStore } from "@workspace/shortcuts/ports/overrides-store.settings";
import { createStorageOverridesStore } from "@workspace/shortcuts/ports/overrides-store.storage";
import { ShortcutsProvider } from "@workspace/shortcuts/react/context";
import { Button } from "@workspace/ui/components/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty";
import { Spinner } from "@workspace/ui/components/spinner";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { routes } from "@/lib/routes";

import { ApiProvider, useApi } from "./api";
import {
  createIdbPersister,
  gatePersister,
  PERSIST_MAX_AGE_MS,
} from "./query-persistence";
import {
  openSettings as openSettingsView,
  type SettingsSection,
} from "./settings/settings-route";
import { SHELL_LAYOUT_KEY, SIDEBAR_ATTRIBUTE } from "./shell-prepaint";
import {
  readActiveSpace,
  spaceFromQuery,
  writeActiveSpace,
} from "./spaces/active-space";
import { useAfterBoot } from "./use-after-boot";

// The signed-in app's client frame (039): the query cache (persisted to
// IndexedDB unless the user's orgs say no, D28), the API client, shortcuts
// (kept in user settings), the shell layout every page shares, and the
// global surfaces. Chat, library, settings and admin pages
// all render inside it, so moving between them keeps the cache, the layout
// and the palette.

/** What the chat route lets the palette offer (model, context, sandbox). */
export interface ChatState {
  readonly draftContext: ChatContext;
  readonly paletteContext: PaletteContext | undefined;
  readonly setDraftContext: (context: ChatContext) => void;
  readonly setPaletteContext: (context: PaletteContext | undefined) => void;
  readonly setTarget: (target: RunTarget) => void;
  /** Picked in the composer or the palette; `null` until someone picks. */
  readonly target: RunTarget | null;
}

export interface AppFrameValue {
  readonly chat: ChatState;
  readonly config: PublicConfig;
  readonly layout: ShellLayoutState;
  readonly me: Me;
  /** Opens "New organisation" (the account menu's). */
  readonly openNewOrg: () => void;
  readonly openPalette: () => void;
  /** Opens settings, full screen over the current page (185). */
  readonly openSettings: (section?: SettingsSection) => void;
  readonly paletteOpen: boolean;
  readonly setPaletteOpen: (open: boolean) => void;
  readonly setTheme: (theme: Theme) => void;
  readonly signOut: () => void;
  readonly theme: Theme;
}

const AppFrameContext = createContext<AppFrameValue | null>(null);

/** Tests render pages under a hand-built frame. */
export const AppFrameProvider = AppFrameContext.Provider;

export const useAppFrame = (): AppFrameValue => {
  const value = useContext(AppFrameContext);
  if (!value) {
    // Every signed-in page renders under the (app) layout.
    throw new Error("useAppFrame needs <AppFrame>");
  }
  return value;
};

// Not needed to type, so not in the chat route's first load (D27).
const GlobalSurfaces = dynamic(
  () => import("./global-surfaces").then((module) => module.GlobalSurfaces),
  { ssr: false }
);

// Loaded the first time someone asks for it.
const NewOrgDialog = dynamic(
  () => import("./new-org-dialog").then((module) => module.NewOrgDialog),
  { ssr: false }
);

/** Whether `me` can reach the admin pages: the instance admin, or an org owner or admin. */
export const canAdmin = (me: Me): boolean =>
  me.user.isAdmin ||
  me.orgs.some(
    (org) =>
      !org.isPersonal && (org.myRole === "owner" || org.myRole === "admin")
  );

/** "New organisation": the dialog, loaded on first use, and where it goes after. */
const useNewOrg = () => {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // Stays mounted once used, so closing it can fade out.
  const [used, setUsed] = useState(false);
  const openNewOrg = useCallback(() => {
    setUsed(true);
    setOpen(true);
  }, []);
  const created = useCallback(
    (org: Org) =>
      router.push(
        routes.spaceSettings({ id: org.id, type: "org" }, "space-subspaces")
      ),
    [router]
  );
  const dialog = used ? (
    <NewOrgDialog onCreated={created} onOpenChange={setOpen} open={open} />
  ) : null;
  return { dialog, openNewOrg };
};

const browserStorage = () => {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    // Storage blocked (privacy settings): shortcuts fall back to defaults.
    return null;
  }
};

/**
 * The shell layout, shared by every page, and the pre-paint mark kept in
 * step with it. The first render is the server's (default) layout, which the
 * inline script has already corrected for; from then on the mark follows the
 * state, before paint.
 */
const useSharedShellLayout = (): ShellLayoutState => {
  const layout = useShellLayout(SHELL_LAYOUT_KEY);
  // `null` until the first run, which renders the server's default layout:
  // the inline script has already marked what the stored one says.
  const synced = useRef<boolean | null>(null);
  const { sidebarOpen } = layout.layout;
  useLayoutEffect(() => {
    const firstRun = synced.current === null;
    synced.current = sidebarOpen;
    if (firstRun) {
      return;
    }
    if (sidebarOpen) {
      document.documentElement.removeAttribute(SIDEBAR_ATTRIBUTE);
    } else {
      document.documentElement.setAttribute(SIDEBAR_ATTRIBUTE, "closed");
    }
  }, [sidebarOpen]);
  return layout;
};

const useFrameTheme = () => {
  const { setTheme, theme } = useTheme();
  return {
    setTheme: setTheme as (theme: Theme) => void,
    theme: themeSchema.catch("system").parse(theme),
  };
};

const statusOf = (error: unknown): number | null =>
  typeof error === "object" &&
  error !== null &&
  "status" in error &&
  typeof error.status === "number"
    ? error.status
    : null;

const FrameMessage = ({
  children,
  onRetry,
}: {
  readonly children: ReactNode;
  readonly onRetry?: () => void;
}) => (
  <main className="flex min-h-svh items-center justify-center p-6">
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          {onRetry ? <CircleAlertIcon /> : <Spinner />}
        </EmptyMedia>
        {children}
      </EmptyHeader>
      {onRetry ? (
        <EmptyContent>
          <Button onClick={onRetry} variant="outline">
            <Trans>Try again</Trans>
          </Button>
        </EmptyContent>
      ) : null}
    </Empty>
  </main>
);

/**
 * Who's signed in. The server usually knows already (the layout asked the
 * API); when it couldn't, the browser asks. "Not signed in" goes to sign-in.
 */
const SignedIn = ({
  children,
}: {
  readonly children: (me: Me) => ReactNode;
}) => {
  const { query } = useApi();
  // A 4xx won't change on a retry (401 is "signed out", 404 "no API").
  const me = useQuery(
    query.me.get.queryOptions({
      retry: (count, error) => count < 1 && (statusOf(error) ?? 500) >= 500,
    })
  );
  const signedOut = me.isError && statusOf(me.error) === 401;
  useEffect(() => {
    if (signedOut) {
      window.location.replace(routes.signInThen(window.location.pathname));
    }
  }, [signedOut]);
  if (me.data) {
    return <>{children(me.data)}</>;
  }
  if (me.isError && !signedOut) {
    return (
      <FrameMessage onRetry={me.refetch}>
        <EmptyTitle>
          <Trans>Can't reach the server</Trans>
        </EmptyTitle>
        <EmptyDescription>
          <Trans>
            Check your connection. If it keeps happening, the server may be
            restarting.
          </Trans>
        </EmptyDescription>
      </FrameMessage>
    );
  }
  return (
    <FrameMessage>
      <EmptyTitle className="sr-only">
        <Trans>Loading</Trans>
      </EmptyTitle>
    </FrameMessage>
  );
};

const Frame = ({
  children,
  config,
  me,
  onSignOut,
  surfaces,
}: {
  readonly children: ReactNode;
  readonly config: PublicConfig;
  readonly me: Me;
  readonly onSignOut: () => void;
  readonly surfaces: boolean;
}) => {
  const layout = useSharedShellLayout();
  const { setTheme, theme } = useFrameTheme();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [draftContext, setDraftContextState] = useState<ChatContext>({
    type: "personal",
  });
  // The active space (191) is remembered per browser; read after mount so
  // the server render and the first client render agree.
  // A link to one space's settings (`?space=team:<id>`) makes it active.
  useEffect(() => {
    const linked = spaceFromQuery(window.location.search);
    if (linked) {
      writeActiveSpace(window.localStorage, linked);
    }
    setDraftContextState(linked ?? readActiveSpace(window.localStorage));
  }, []);
  const setDraftContext = useCallback((context: ChatContext) => {
    setDraftContextState(context);
    writeActiveSpace(window.localStorage, context);
  }, []);
  const [target, setTarget] = useState<RunTarget | null>(null);
  const [paletteContext, setPaletteContext] = useState<
    PaletteContext | undefined
  >();
  const openPalette = useCallback(() => setPaletteOpen(true), []);
  const openSettings = useCallback(
    (section?: SettingsSection) =>
      openSettingsView(window.history, window.location.pathname, section),
    []
  );
  const booted = useAfterBoot();
  const newOrg = useNewOrg();
  const { openNewOrg } = newOrg;

  const value = useMemo(
    (): AppFrameValue => ({
      chat: {
        draftContext,
        paletteContext,
        setDraftContext,
        setPaletteContext,
        setTarget,
        target,
      },
      config,
      layout,
      me,
      openNewOrg,
      openPalette,
      openSettings,
      paletteOpen,
      setPaletteOpen,
      setTheme,
      signOut: onSignOut,
      theme,
    }),
    [
      config,
      draftContext,
      setDraftContext,
      layout,
      me,
      onSignOut,
      openNewOrg,
      openPalette,
      openSettings,
      paletteContext,
      paletteOpen,
      setTheme,
      target,
      theme,
    ]
  );
  return (
    <AppFrameContext.Provider value={value}>
      {children}
      {booted && surfaces ? <GlobalSurfaces /> : null}
      {newOrg.dialog}
    </AppFrameContext.Provider>
  );
};

export const AppFrame = ({
  children,
  config,
  initialMe,
  surfaces = true,
}: {
  readonly children: ReactNode;
  readonly config: PublicConfig;
  /** From the server when it could ask; the browser asks otherwise. */
  readonly initialMe: Me | null;
  /**
   * The palette, the `?` dialog and the shortcuts every page shares. Quick
   * AI's page (118) goes without: it's one page in a window of its own.
   */
  readonly surfaces?: boolean;
}) => {
  const [client] = useState(() => createApiClient());
  const [queryClient] = useState(() => {
    const created = new QueryClient({
      defaultOptions: {
        queries: {
          // Rendering from the persisted cache is the point (D28): show it,
          // then revalidate. A day keeps it restorable across a weekend.
          gcTime: 24 * 60 * 60 * 1000,
          refetchOnWindowFocus: false,
          retry: 1,
          staleTime: 30_000,
        },
      },
    });
    // D27: what the server already knows goes straight into the cache.
    const query = createQueryUtils(client);
    created.setQueryData(query.meta.config.queryKey(), config);
    if (initialMe) {
      created.setQueryData(query.me.get.queryKey(), initialMe);
    }
    return created;
  });
  const [persister] = useState(() => {
    const meKey = createQueryUtils(client).me.get.queryKey();
    // Read at each write, so a policy change applies without a reload.
    return gatePersister(
      createIdbPersister(),
      () => queryClient.getQueryData<Me>(meKey)?.persistClientCache ?? false
    );
  });
  const [authClient] = useState(() => createWebAuthClient());
  const userId = initialMe?.user.id ?? "";
  const [store] = useState(() =>
    createSettingsOverridesStore(
      {
        load: async () => (await client.me.settings()).shortcuts,
        save: async (shortcuts) =>
          (await client.me.updateSettings({ shortcuts })).shortcuts,
      },
      createStorageOverridesStore(browserStorage(), `shortcuts:${userId}`)
    )
  );

  const signOut = useCallback(() => {
    const leave = async () => {
      await authClient.signOut().catch(() => undefined);
      // Nothing of this account stays in memory or on disk.
      await persister.removeClient();
      queryClient.clear();
      window.location.replace(routes.signIn);
    };
    leave().catch(() => undefined);
  }, [authClient, persister, queryClient]);

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        // Another account's cache is never restored into this one.
        buster: userId,
        maxAge: PERSIST_MAX_AGE_MS,
        persister,
      }}
    >
      <ApiProvider client={client}>
        <ShortcutsProvider store={store}>
          <SignedIn>
            {(me) => (
              <Frame
                config={config}
                me={me}
                onSignOut={signOut}
                surfaces={surfaces}
              >
                {children}
              </Frame>
            )}
          </SignedIn>
        </ShortcutsProvider>
      </ApiProvider>
    </PersistQueryClientProvider>
  );
};

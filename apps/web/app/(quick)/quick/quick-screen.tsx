"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Markdown } from "@workspace/chat-ui/conversation/markdown";
import { PulseLabel } from "@workspace/chat-ui/conversation/pulse-label";
import type { RunCreated } from "@workspace/client/run-transport";
import { useRunChat } from "@workspace/client/use-run-chat";
import { ComposerLoader } from "@workspace/composer/components/composer-loader";
import type {
  AttachmentLimits,
  ComposerValue,
} from "@workspace/composer/schemas";
import type { ConversationId, RunId } from "@workspace/contract/schemas/common";
import type { RunTarget } from "@workspace/contract/schemas/runs";
import type { ChatContext } from "@workspace/contract/schemas/tenancy";
import { SparklesIcon } from "@workspace/icons";
import { readDesktopBridge } from "@workspace/shortcuts/desktop";
import { comboKeycaps } from "@workspace/shortcuts/keys";
import { useDetectedPlatform } from "@workspace/shortcuts/react/context";
import { Button } from "@workspace/ui/components/button";
import { Kbd, KbdGroup } from "@workspace/ui/components/kbd";
import { cn } from "@workspace/ui/lib/utils";
import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { useApi } from "@/app/(app)/_shared/api";
import { routes } from "@/lib/routes";

// Quick AI (118): the composer, and the reply to what was asked, compactly.
// The desktop app shows this page in a small floating window (the shell
// sizes the window to the page). Every send starts a new chat. ⏎ answers
// here; ⌘⏎ (Ctrl+Enter elsewhere) opens the chat in the app's main window
// once its run has started, where the reply carries on, and with a reply
// showing and nothing typed it opens that reply's chat. Escape hides the
// window. In a browser the page works too: ⌘⏎ goes to the chat.
//
// It looks like a launcher (135, after Raycast): one tall strip, an icon,
// the input in large type and Send, nothing else, on the window's native
// translucent material. A reply opens below a hairline, with a small muted
// footer that names the action ⌘⏎ takes. Nothing in it shows a scrollbar.

const PERSONAL: ChatContext = { type: "personal" };

// Text only, for now: attachments need the app's upload and workspace
// handling, which the full chat screen has.
const NO_ATTACHMENTS: AttachmentLimits = { maxFiles: 0 };

const ignore = () => undefined;

interface QuickAsk {
  readonly conversationId: ConversationId;
  /** ⌘⏎: hand the chat to the main window once its run exists. */
  readonly openInApp: boolean;
  readonly target: RunTarget | null;
  readonly text: string;
}

/**
 * Goes to the chat. In the desktop app the Quick AI window never leaves
 * `/quick`: the shell shows the chat in the main window instead. In a
 * browser this tab goes there.
 */
const goToChat = (id: ConversationId) => {
  window.location.assign(routes.chat(id));
};

type ChatMessage = ReturnType<typeof useRunChat>["messages"][number];

/** The reply's text so far: its text parts, in order. Pure. */
export const replyText = (message: ChatMessage | undefined): string =>
  message?.role === "assistant"
    ? message.parts
        .flatMap((part) => (part.type === "text" ? [part.text] : []))
        .join("\n\n")
    : "";

/** Menus that take Escape for themselves: the composer's suggestions, the + menu. */
const OPEN_MENU = '[data-slot="composer-suggestions"], [role="menu"]';

const COMPOSER_INPUT = '[data-slot="composer"] [role="textbox"]';

/** Focuses the composer's editor, once it's on the page. */
const focusComposer = () => {
  document.querySelector<HTMLElement>(COMPOSER_INPUT)?.focus();
};

/** Whether nothing's typed: the shell's textarea or the editor. */
const composerEmpty = (): boolean => {
  const input = document.querySelector<HTMLElement>(COMPOSER_INPUT);
  const text =
    input instanceof HTMLTextAreaElement ? input.value : input?.textContent;
  return (text ?? "").trim() === "";
};

/**
 * Hairlines between the strip, the reply and its footer: the foreground at
 * a tenth, so they read on any material, light or dark.
 */
const HAIRLINE = "border-foreground/10 border-t";

/**
 * One ask: sends `text` to the new chat as soon as it mounts and shows the
 * reply as it streams. Keyed by the chat, so the next ask starts afresh.
 */
function QuickTurn({
  ask,
  onBusyChange,
  onHandedOff,
  onStopReady,
}: {
  readonly ask: QuickAsk;
  readonly onBusyChange: (busy: boolean) => void;
  /** The chat went to the main window; this ask is done here. */
  readonly onHandedOff: () => void;
  /** Hands the composer a way to stop this ask's run. */
  readonly onStopReady: (stop: (() => void) | null) => void;
}) {
  const { client } = useApi();
  // The run this ask started, for Stop.
  const run = useRef<{ id: RunId | null }>({ id: null });
  const onRunCreated = useCallback(
    (created: RunCreated) => {
      run.current.id = created.runId;
      if (ask.openInApp) {
        goToChat(ask.conversationId);
        onHandedOff();
      }
    },
    [ask, onHandedOff]
  );
  const chat = useRunChat({
    client,
    conversationId: ask.conversationId,
    onRunCreated,
    runFields: () => ({
      context: PERSONAL,
      ...(ask.target ? { target: ask.target } : {}),
    }),
  });
  const { error, messages, sendMessage, status, stop } = chat;

  // Once, though development mounts effects twice.
  const sentTo = useRef<ConversationId | null>(null);
  useEffect(() => {
    if (sentTo.current !== ask.conversationId) {
      sentTo.current = ask.conversationId;
      sendMessage({ text: ask.text }).catch(ignore);
    }
  }, [ask.conversationId, ask.text, sendMessage]);

  const busy = status === "submitted" || status === "streaming";
  useEffect(() => {
    onBusyChange(busy);
  }, [busy, onBusyChange]);
  useEffect(() => {
    onStopReady(() => {
      const { id } = run.current;
      // Stops the run on the server, as the chat screen's Stop does.
      if (id !== null) {
        client.runs.cancel({ id }).catch(ignore);
      }
      stop().catch(ignore);
    });
    return () => onStopReady(null);
  }, [client, onStopReady, stop]);

  const open = useCallback(
    () => goToChat(ask.conversationId),
    [ask.conversationId]
  );

  if (ask.openInApp) {
    return (
      <p className={cn(HAIRLINE, "px-4 py-3 text-muted-foreground text-sm")}>
        <Trans>Opening the chat in the app…</Trans>
      </p>
    );
  }
  const reply = replyText(messages.at(-1));
  return (
    <section
      aria-label={ask.text}
      className={cn(HAIRLINE, "flex min-h-0 flex-col")}
      data-slot="quick-turn"
    >
      <div
        aria-busy={busy}
        aria-live="polite"
        className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-3 text-sm leading-relaxed"
        data-slot="quick-reply"
      >
        {reply === "" && busy ? (
          <PulseLabel>
            <Trans>Sending…</Trans>
          </PulseLabel>
        ) : null}
        {reply === "" ? null : (
          <Markdown streaming={status === "streaming"}>{reply}</Markdown>
        )}
        {error ? (
          <p className="text-destructive" role="alert">
            <Trans>The reply didn't finish. Open the chat to try again.</Trans>
          </p>
        ) : null}
      </div>
      <footer
        className={cn(
          HAIRLINE,
          "flex h-10 shrink-0 items-center justify-between gap-3 ps-4 pe-2 text-muted-foreground text-xs"
        )}
        data-slot="quick-footer"
      >
        <span className="min-w-0 truncate">{ask.text}</span>
        <Button
          className="shrink-0 text-muted-foreground"
          onClick={open}
          size="xs"
          variant="ghost"
        >
          <Trans>Open in the app</Trans>
          <Keys combo="Mod+Enter" />
        </Button>
      </footer>
    </section>
  );
}

function Keys({ combo }: { readonly combo: string }) {
  const platform = useDetectedPlatform();
  return (
    <KbdGroup aria-hidden>
      {comboKeycaps(combo, platform).map((key) => (
        <Kbd key={key}>{key}</Kbd>
      ))}
    </KbdGroup>
  );
}

export function QuickScreen() {
  const { t } = useLingui();
  const { query } = useApi();
  const settings = useQuery(query.me.settings.queryOptions());
  const { mutateAsync: createChat, isPending: creating } = useMutation(
    query.conversations.create.mutationOptions()
  );
  const [ask, setAsk] = useState<QuickAsk | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [stopRun, setStopRun] = useState<(() => void) | null>(null);
  // Whether the Enter that sends was ⌘⏎ (or Ctrl+Enter): read when the
  // composer submits, which happens inside that key's handler.
  const openInApp = useRef(false);

  const onKeyDownCapture = useCallback(
    (event: KeyboardEvent) => {
      if (event.key !== "Enter") {
        return;
      }
      const toApp = event.metaKey || event.ctrlKey;
      openInApp.current = toApp;
      // Nothing to send: ⌘⏎ opens the reply on show, as its footer says.
      if (toApp && ask && !ask.openInApp && composerEmpty()) {
        goToChat(ask.conversationId);
      }
    },
    [ask]
  );

  const onSubmit = useCallback(
    (value: ComposerValue) => {
      const toApp = openInApp.current;
      openInApp.current = false;
      // The person's own default; without one the server picks (111).
      const target = settings.data?.defaultTarget ?? null;
      setFailed(false);
      createChat({
        context: PERSONAL,
        ...(target ? { defaultTarget: target } : {}),
      }).then(
        (created) =>
          setAsk({
            conversationId: created.id,
            openInApp: toApp,
            target,
            text: value.text,
          }),
        () => setFailed(true)
      );
    },
    [createChat, settings.data?.defaultTarget]
  );

  const handedOff = useCallback(() => {
    // The main window has the chat now; this window is ready for the next.
    setAsk(null);
    setBusy(false);
  }, []);
  const onStopReady = useCallback((stop: (() => void) | null) => {
    setStopRun(() => stop);
  }, []);

  // In the desktop app: Escape hides the window, unless a menu is open (it
  // takes Escape for itself; the editor marks every Escape handled, so
  // `defaultPrevented` can't tell); and the composer has focus each time the
  // window comes back.
  useEffect(() => {
    const hideQuickAi = readDesktopBridge(window)?.hideQuickAi;
    if (!hideQuickAi) {
      return;
    }
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && !document.querySelector(OPEN_MENU)) {
        hideQuickAi();
      }
    };
    // Captured, so a menu that closes on this Escape still counts as open.
    window.addEventListener("keydown", onKeyDown, { capture: true });
    window.addEventListener("focus", focusComposer);
    return () => {
      window.removeEventListener("keydown", onKeyDown, { capture: true });
      window.removeEventListener("focus", focusComposer);
    };
  }, []);

  let status: "ready" | "submitted" | "streaming" = "ready";
  if (creating) {
    status = "submitted";
  } else if (busy) {
    status = "streaming";
  }

  return (
    <main
      // As tall as the Quick AI window gets (apps/desktop's QUICK_WINDOW):
      // past that the reply scrolls, not the page.
      className="flex max-h-140 flex-col text-foreground"
      data-slot="quick"
      onKeyDownCapture={onKeyDownCapture}
    >
      <h1 className="sr-only">
        <Trans>Quick AI</Trans>
      </h1>
      <div className="flex shrink-0 items-start">
        <span
          aria-hidden
          className="flex h-15 shrink-0 items-center ps-4 pe-2 text-muted-foreground"
        >
          <SparklesIcon className="size-5" />
        </span>
        <ComposerLoader
          appearance="strip"
          attachmentLimits={NO_ATTACHMENTS}
          className="min-w-0 flex-1"
          onStop={stopRun ?? undefined}
          onSubmit={onSubmit}
          placeholder={t`Ask anything…`}
          status={status}
        />
      </div>
      {failed ? (
        <p
          className={cn(HAIRLINE, "px-4 py-3 text-destructive text-sm")}
          role="alert"
        >
          <Trans>
            Couldn't start a chat. Check your connection and try again.
          </Trans>
        </p>
      ) : null}
      {ask ? (
        <QuickTurn
          ask={ask}
          key={ask.conversationId}
          onBusyChange={setBusy}
          onHandedOff={handedOff}
          onStopReady={onStopReady}
        />
      ) : null}
    </main>
  );
}

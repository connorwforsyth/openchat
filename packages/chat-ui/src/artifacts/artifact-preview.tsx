"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import type { ArtifactKind } from "@workspace/contract/schemas/message-parts";
import { CircleAlertIcon, LoaderCircleIcon } from "@workspace/icons";
import { Button } from "@workspace/ui/components/button";
import { cn } from "@workspace/ui/lib/utils";
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { frameDocument } from "../model/artifacts";
import {
  type RenderRequest,
  RUNTIME_CHANNEL,
  RUNTIME_IMPORTS,
  type RuntimeError,
  type RuntimeKind,
  type RuntimeTheme,
  readFrameMessage,
  runtimeUrl,
} from "./runtime-protocol";

// A live preview of an artifact (D24). With a runtime origin configured
// (`ARTIFACTS_ORIGIN`), the artifact renders in the artifact runtime: a page
// on that separate origin, in an iframe sandboxed to scripts only, so it has
// an opaque origin and can't reach this app's cookies, storage or DOM. We
// post it the code, and it reports back errors and its content height.
//
// Without a runtime (an empty .env), HTML and SVG render in a `srcdoc` frame
// under the same sandbox; React, Mermaid and sites need the runtime's
// compiler and renderer, so they say so instead. A runtime that's slow to
// answer keeps its frame: the preview says it's waiting, offers a retry, and
// shows the render whenever it arrives.

/** How long the runtime has to say `ready` before the preview says it's waiting. */
export const RUNTIME_READY_TIMEOUT_MS = 10_000;

export interface ArtifactPreviewProps {
  readonly content: string;
  /** Stamped into React elements as `data-src="<fileName>:<line>"` (D16). */
  readonly fileName: string;
  readonly kind: RuntimeKind;
  /** Switches the view to the source, offered when there's no preview. */
  readonly onShowSource?: () => void;
  /** Overrides `RUNTIME_READY_TIMEOUT_MS`, for tests. */
  readonly readyTimeoutMs?: number;
  /** The runtime's origin, or `null` when none is configured. */
  readonly runtimeOrigin: string | null;
  readonly title: string;
}

/** Kinds a `srcdoc` frame can draw without the runtime. */
const drawsWithoutRuntime = (kind: RuntimeKind): kind is "html" | "svg" =>
  kind === "html" || kind === "svg";

export function ArtifactPreview(props: ArtifactPreviewProps) {
  if (props.runtimeOrigin) {
    return <RuntimePreview {...props} runtimeOrigin={props.runtimeOrigin} />;
  }
  if (drawsWithoutRuntime(props.kind)) {
    return (
      <SrcdocPreview
        content={props.content}
        kind={props.kind}
        title={props.title}
      />
    );
  }
  return (
    <PreviewUnavailable onShowSource={props.onShowSource} reason="no-runtime" />
  );
}

/**
 * Why there's no preview, where the preview would be, with the ways on:
 * the source, and trying the service again when it stopped answering.
 */
export function PreviewUnavailable({
  onRetry,
  onShowSource,
  reason,
}: {
  readonly onRetry?: (() => void) | undefined;
  readonly onShowSource?: (() => void) | undefined;
  readonly reason: "no-runtime" | "slow";
}) {
  return (
    <div
      className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center"
      role="status"
    >
      <CircleAlertIcon aria-hidden className="size-6 text-muted-foreground" />
      <p className="max-w-80 text-balance text-muted-foreground text-sm">
        {reason === "slow" ? (
          <Trans>
            The artifacts service hasn't answered yet. It may still be starting,
            or it may have stopped. The preview appears as soon as it answers.
          </Trans>
        ) : (
          <Trans>
            This preview needs the artifacts service, which isn't running on
            this instance.
          </Trans>
        )}
      </p>
      <div className="flex gap-2">
        {onRetry ? (
          <Button onClick={onRetry} size="sm" variant="outline">
            <Trans>Try again</Trans>
          </Button>
        ) : null}
        {onShowSource ? (
          <Button onClick={onShowSource} size="sm" variant="ghost">
            <Trans>Show the code</Trans>
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/** HTML and SVG straight into a sandboxed `srcdoc` frame (an opaque origin). */
export function SrcdocPreview({
  content,
  kind,
  title,
}: {
  readonly content: string;
  readonly kind: ArtifactKind;
  readonly title: string;
}) {
  const { t } = useLingui();
  return (
    <iframe
      // Flush under the view's header row (075): the frame is the page.
      className="block min-h-80 w-full flex-1 bg-background"
      referrerPolicy="no-referrer"
      sandbox="allow-scripts"
      srcDoc={frameDocument(kind, content)}
      title={t`Preview of ${title}`}
    />
  );
}

type FrameState =
  | { readonly status: "loading" }
  | { readonly status: "rendered" }
  | { readonly error: RuntimeError; readonly status: "error" };

/**
 * Where the preview stands with the runtime: waiting for its frame to say
 * `ready`, ready, or still waiting after `RUNTIME_READY_TIMEOUT_MS`.
 */
export type RuntimeWait = "connecting" | "ready" | "slow";

/** Pure. */
export const runtimeWait = (ready: boolean, timedOut: boolean): RuntimeWait => {
  if (ready) {
    return "ready";
  }
  return timedOut ? "slow" : "connecting";
};

/** Whether `ms` have passed since `attempt` began without the frame being ready. */
const useTimedOut = (ready: boolean, attempt: number, ms: number): boolean => {
  const [expired, setExpired] = useState<number | null>(null);
  useEffect(() => {
    if (ready) {
      return;
    }
    const timer = window.setTimeout(() => setExpired(attempt), ms);
    return () => window.clearTimeout(timer);
  }, [attempt, ms, ready]);
  return expired === attempt;
};

function RuntimePreview({
  content,
  fileName,
  kind,
  onShowSource,
  readyTimeoutMs = RUNTIME_READY_TIMEOUT_MS,
  runtimeOrigin,
  title,
}: ArtifactPreviewProps & { readonly runtimeOrigin: string }) {
  const { t } = useLingui();
  const frameRef = useRef<HTMLIFrameElement>(null);
  // Each retry is a new frame; `ready` and the render belong to one.
  const [attempt, setAttempt] = useState(0);
  const [ready, setReady] = useState(false);
  const lastId = useRef(0);
  const [state, setState] = useState<FrameState>({ status: "loading" });
  const [height, setHeight] = useState<number | null>(null);
  const theme = useDocumentTheme();
  const parentOrigin = useParentOrigin();
  const wait = runtimeWait(ready, useTimedOut(ready, attempt, readyTimeoutMs));

  const retry = useCallback(() => {
    setReady(false);
    setState({ status: "loading" });
    setHeight(null);
    setAttempt((count) => count + 1);
  }, []);

  const post = useEffectEvent(() => {
    const frame = frameRef.current?.contentWindow;
    if (!(frame && ready)) {
      return;
    }
    lastId.current += 1;
    const request: RenderRequest = {
      channel: RUNTIME_CHANNEL,
      code: content,
      fileName,
      id: String(lastId.current),
      kind,
      theme,
      title,
      type: "render",
    };
    // The frame's origin is opaque, so there's no origin to target. The
    // code is what the frame displays anyway; nothing secret goes with it.
    frame.postMessage(request, "*");
  });

  // Render once the runtime is ready, then again in place whenever the
  // artifact or the theme changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: these are the triggers; `post` reads them.
  useEffect(() => post(), [ready, content, fileName, kind, theme, title]);

  const onMessage = useEffectEvent((event: MessageEvent) => {
    const message = readFrameMessage(event, frameRef.current?.contentWindow);
    if (!message.ok) {
      return;
    }
    // Nothing posted yet means nothing to reply to.
    const current = lastId.current > 0 ? String(lastId.current) : null;
    switch (message.value.type) {
      case "ready":
        // Said again after the frame reloads; the render it had is gone.
        if (ready) {
          post();
        } else {
          setReady(true);
        }
        return;
      case "rendered":
        if (message.value.id === current) {
          setState({ status: "rendered" });
        }
        return;
      case "error":
        if (message.value.id === current) {
          setState({ error: message.value.error, status: "error" });
        }
        return;
      case "resize":
        setHeight(message.value.height);
        return;
      // A deck's (164); its own preview listens for them.
      case "position":
      case "exported":
      case "export-failed":
      case "layout":
      case "picked":
        return;
      default:
        return message.value satisfies never;
    }
  });

  useEffect(() => {
    const listener = (event: MessageEvent) => onMessage(event);
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, []);

  if (!parentOrigin) {
    return null;
  }
  // HTML and SVG draw without the runtime, so a slow one shows them that
  // way, and says so, while its own frame keeps loading out of sight.
  const standIn = wait === "slow" && drawsWithoutRuntime(kind);
  return (
    <div className="relative flex flex-1 flex-col">
      {state.status === "error" ? <PreviewError error={state.error} /> : null}
      {standIn ? (
        <>
          <SlowNotice onRetry={retry} />
          <SrcdocPreview content={content} kind={kind} title={title} />
        </>
      ) : null}
      <iframe
        // Until the page reports its height, it fills the view.
        className={cn(
          "block min-h-80 w-full bg-background",
          height === null && "flex-1",
          standIn && "hidden"
        )}
        key={attempt}
        ref={frameRef}
        referrerPolicy="no-referrer"
        sandbox="allow-scripts"
        src={runtimeUrl(runtimeOrigin, parentOrigin, kind)}
        style={height === null ? undefined : { height }}
        title={
          standIn ? t`Runtime preview of ${title}` : t`Preview of ${title}`
        }
      />
      {wait === "slow" && !standIn ? (
        <div className="absolute inset-0 flex bg-background">
          <PreviewUnavailable
            onRetry={retry}
            onShowSource={onShowSource}
            reason="slow"
          />
        </div>
      ) : null}
      {wait !== "slow" && state.status === "loading" ? (
        <div
          className="absolute inset-0 flex items-center justify-center gap-2 bg-background text-muted-foreground text-sm"
          role="status"
        >
          <LoaderCircleIcon aria-hidden className="size-4 animate-spin" />
          <Trans>Loading preview</Trans>
        </div>
      ) : null}
    </div>
  );
}

/** The strip over a stand-in preview: why it's plain, and a retry. */
function SlowNotice({ onRetry }: { readonly onRetry: () => void }) {
  return (
    <div
      className="flex items-center gap-2 border-border border-b bg-muted/50 px-4 py-2 text-muted-foreground text-sm"
      role="status"
    >
      <CircleAlertIcon aria-hidden className="size-4 shrink-0" />
      <p className="min-w-0 flex-1">
        <Trans>
          The artifacts service hasn't answered yet, so this is a plain preview.
        </Trans>
      </p>
      <Button onClick={onRetry} size="sm" variant="outline">
        <Trans>Try again</Trans>
      </Button>
    </div>
  );
}

function PreviewError({ error }: { readonly error: RuntimeError }) {
  const allowed = RUNTIME_IMPORTS.join(", ");
  const module = error.message;
  const heading = (() => {
    switch (error.kind) {
      case "syntax":
        return <Trans>This artifact has a syntax error.</Trans>;
      case "import":
        return (
          <Trans>
            Previews can't import "{module}". React artifacts can import{" "}
            {allowed}.
          </Trans>
        );
      case "export":
        return (
          <Trans>
            A React artifact needs a default export: a component or an element.
          </Trans>
        );
      case "render":
        return <Trans>This artifact failed while rendering.</Trans>;
      default:
        return error.kind satisfies never;
    }
  })();
  const detail =
    error.kind === "syntax" || error.kind === "render" ? error.message : "";

  return (
    <div
      // A strip over the frame, not a card: the view stays flush (075).
      className="flex gap-2 bg-destructive/5 px-4 py-3 text-sm"
      role="alert"
    >
      <CircleAlertIcon
        aria-hidden
        className="mt-0.5 size-4 shrink-0 text-destructive"
      />
      <div className="min-w-0 flex-1">
        <p className="text-destructive">{heading}</p>
        {detail ? (
          <pre className="mt-1 overflow-x-auto whitespace-pre-wrap font-mono text-muted-foreground text-xs">
            {detail}
          </pre>
        ) : null}
      </div>
    </div>
  );
}

// The app's theme is a `dark` class on <html> (next-themes). The runtime
// can't see it, so we pass it along with the artifact.
const subscribeTheme = (onChange: () => void) => {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributeFilter: ["class"],
    attributes: true,
  });
  return () => observer.disconnect();
};
const themeSnapshot = (): RuntimeTheme =>
  document.documentElement.classList.contains("dark") ? "dark" : "light";
const serverTheme = (): RuntimeTheme => "light";

export const useDocumentTheme = () =>
  useSyncExternalStore(subscribeTheme, themeSnapshot, serverTheme);

const noSubscription = () => () => undefined;
export const useParentOrigin = () =>
  useSyncExternalStore(
    noSubscription,
    () => window.location.origin,
    () => null
  );

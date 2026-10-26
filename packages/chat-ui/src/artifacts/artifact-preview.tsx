"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import type { ArtifactKind } from "@workspace/contract/schemas/message-parts";
import { CircleAlertIcon } from "@workspace/icons";
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
// Without a runtime (an empty .env), or if it never answers, HTML and SVG
// fall back to a `srcdoc` frame under the same sandbox; React and Mermaid
// need the runtime's compiler and renderer, so they say so instead.

/** How long the runtime has to say `ready` before we stop waiting. */
export const RUNTIME_READY_TIMEOUT_MS = 8000;

export interface ArtifactPreviewProps {
  readonly content: string;
  /** Stamped into React elements as `data-src="<fileName>:<line>"` (D16). */
  readonly fileName: string;
  readonly kind: RuntimeKind;
  /** Overrides `RUNTIME_READY_TIMEOUT_MS`, for tests. */
  readonly readyTimeoutMs?: number;
  /** The runtime's origin, or `null` when none is configured. */
  readonly runtimeOrigin: string | null;
  readonly title: string;
}

export function ArtifactPreview(props: ArtifactPreviewProps) {
  const [unreachable, setUnreachable] = useState(false);
  const onUnreachable = useCallback(() => setUnreachable(true), []);

  if (props.runtimeOrigin && !unreachable) {
    return (
      <RuntimePreview
        {...props}
        onUnreachable={onUnreachable}
        runtimeOrigin={props.runtimeOrigin}
      />
    );
  }
  if (props.kind === "html" || props.kind === "svg") {
    return (
      <SrcdocPreview
        content={props.content}
        kind={props.kind}
        title={props.title}
      />
    );
  }
  return (
    <p className="p-4 text-muted-foreground text-sm" role="status">
      {unreachable ? (
        <Trans>
          The preview runtime isn't responding, so this artifact can't be
          previewed right now. Its source is in the Code tab.
        </Trans>
      ) : (
        <Trans>
          Previews of this kind need the artifact runtime. Its source is in the
          Code tab.
        </Trans>
      )}
    </p>
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

function RuntimePreview({
  content,
  fileName,
  kind,
  onUnreachable,
  readyTimeoutMs = RUNTIME_READY_TIMEOUT_MS,
  runtimeOrigin,
  title,
}: ArtifactPreviewProps & {
  readonly onUnreachable: () => void;
  readonly runtimeOrigin: string;
}) {
  const { t } = useLingui();
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const lastId = useRef(0);
  const [state, setState] = useState<FrameState>({ status: "loading" });
  const [height, setHeight] = useState<number | null>(null);
  const theme = useDocumentTheme();
  const parentOrigin = useParentOrigin();

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

  useEffect(() => {
    if (ready) {
      return;
    }
    const timer = window.setTimeout(onUnreachable, readyTimeoutMs);
    return () => window.clearTimeout(timer);
  }, [onUnreachable, ready, readyTimeoutMs]);

  if (!parentOrigin) {
    return null;
  }
  return (
    <div className="flex flex-1 flex-col">
      {state.status === "error" ? <PreviewError error={state.error} /> : null}
      {state.status === "loading" ? (
        <span className="sr-only" role="status">
          <Trans>Loading preview</Trans>
        </span>
      ) : null}
      <iframe
        // Until the page reports its height, it fills the view.
        className={cn(
          "block min-h-80 w-full bg-background",
          height === null && "flex-1"
        )}
        ref={frameRef}
        referrerPolicy="no-referrer"
        sandbox="allow-scripts"
        src={runtimeUrl(runtimeOrigin, parentOrigin, kind)}
        style={height === null ? undefined : { height }}
        title={t`Preview of ${title}`}
      />
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

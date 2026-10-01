"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  EllipsisIcon,
  ExternalLinkIcon,
  FileIcon,
  GlobeIcon,
  RefreshCwIcon,
} from "@workspace/icons";
import { Button } from "@workspace/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@workspace/ui/components/input-group";
import { Spinner } from "@workspace/ui/components/spinner";
import { cn } from "@workspace/ui/lib/utils";
import {
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { usePanelFrame } from "../shell/right-panel";
import { ModeToggle, type ModeToggleProps } from "./mode-toggle";
import {
  type BrowserAction,
  type BrowserHistory,
  type BrowserPage,
  canGoBack,
  canGoForward,
  currentPage,
  type PageTarget,
  type PreviewSources,
  pageUrl,
  readAddress,
  resolveLink,
  type SandboxPreview,
  targetOf,
  workspaceFileOf,
} from "./model/browser";
import { probePreview } from "./model/preview-probe";
import {
  type ReadStaticFile,
  renderStaticPage,
  staticLinkMessageSchema,
} from "./model/static-page";
import { fitBrowserToolbar, type ToolbarFit } from "./model/toolbar";
import { useElementWidth } from "./use-element-width";
import {
  BackToList,
  headerRow,
  RowEndActions,
  useBackToList,
  useRowEnd,
} from "./view-header";

// The Workspace panel's built-in browser (066): back, forward, reload, an
// address bar, a mobile width and open in a new tab, over one page at a
// time. A served page is on the sandbox preview origin, never the app's
// (D24), and every frame is sandboxed on top without `allow-same-origin`:
// no access to the app, no top navigation, no app cookies. So the panel
// can't read where a frame went; the address bar and history are the
// panel's own. A workspace with no ports gets a static render of the HTML
// file instead, labelled as one. The toolbar is the view's one header row
// (070): it never overflows, down to a 340px panel. What doesn't fit moves
// into its "…" menu (`fitBrowserToolbar`).

/** Frame sandboxing: scripts and forms run, the page stays opaque-origin. */
const FRAME_SANDBOX = "allow-scripts allow-forms allow-popups allow-modals";

export interface BrowserViewProps {
  readonly history: BrowserHistory | null;
  /** A rendered file's Preview/Code switch, at the end of the toolbar. */
  readonly modeToggle?: Omit<ModeToggleProps, "labels">;
  readonly onNavigate: (action: BrowserAction) => void;
  /** Whether a URL answers; the default checks from an opaque-origin frame. */
  readonly probe?: (url: string) => Promise<boolean>;
  /** Reads workspace files for a static render; `null` before the workspace exists. */
  readonly readFile: ReadStaticFile | null;
  /** Moves when the agent may have changed files: static pages load again. */
  readonly refreshKey: number | string;
  readonly sources: PreviewSources;
}

export function BrowserView({
  history,
  modeToggle,
  onNavigate,
  probe = probePreview,
  readFile,
  refreshKey,
  sources,
}: BrowserViewProps) {
  const { t } = useLingui();
  const [mobile, setMobile] = useState(false);
  const [toolbar, width] = useElementWidth<HTMLDivElement>();
  const rowEnd = useRowEnd();
  const inPanel = usePanelFrame() !== null;
  const fit = fitBrowserToolbar({
    backToList: useBackToList() !== null,
    close: rowEnd.close && inPanel,
    maximise: rowEnd.maximise !== null,
    toggle: modeToggle !== undefined,
    width,
  });
  const page = currentPage(history);
  const target = page ? targetOf(sources, page) : null;
  const loads = history?.loads ?? 0;

  const back = useCallback(() => onNavigate({ type: "back" }), [onNavigate]);
  const forward = useCallback(
    () => onNavigate({ type: "forward" }),
    [onNavigate]
  );
  const reload = useCallback(
    () => onNavigate({ type: "reload" }),
    [onNavigate]
  );
  const go = useCallback(
    (path: string) =>
      onNavigate({
        page: {
          path,
          port: target?.kind === "server" ? target.preview.port : null,
        },
        type: "navigate",
      }),
    [onNavigate, target]
  );

  const served = page && target?.kind === "server" ? target : null;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        aria-label={t`Browser`}
        className={cn(headerRow, "gap-0.5")}
        ref={toolbar}
        role="toolbar"
      >
        <BackToList />
        <Button
          aria-label={t`Back`}
          disabled={!canGoBack(history)}
          onClick={back}
          size="icon-sm"
          variant="ghost"
        >
          <ArrowLeftIcon aria-hidden />
        </Button>
        {fit.forward ? (
          <Button
            aria-label={t`Forward`}
            disabled={!canGoForward(history)}
            onClick={forward}
            size="icon-sm"
            variant="ghost"
          >
            <ArrowRightIcon aria-hidden />
          </Button>
        ) : null}
        {fit.reload ? (
          <Button
            aria-label={t`Reload`}
            disabled={!page}
            onClick={reload}
            size="icon-sm"
            variant="ghost"
          >
            <RefreshCwIcon aria-hidden />
          </Button>
        ) : null}
        <AddressBar
          // A navigation puts the page's path back in the bar.
          key={`${page?.path ?? ""}#${loads}`}
          onGo={go}
          path={page?.path ?? ""}
          staticLabel={fit.staticLabel}
          target={target}
        />
        <BrowserMenu
          canGoForward={canGoForward(history)}
          fit={fit}
          mobile={mobile}
          newTab={served ? pageUrl(served.preview, page?.path ?? "/") : null}
          onForward={forward}
          onMobileChange={setMobile}
          onReload={page ? reload : null}
        />
        {modeToggle ? (
          <ModeToggle
            {...modeToggle}
            labels={fit.toggleLabels ? "shown" : "hidden"}
          />
        ) : null}
        <RowEndActions />
      </div>
      <div className={cn("flex min-h-0 flex-1", mobile && "bg-muted/30")}>
        <div
          className={cn(
            "flex min-h-0 w-full flex-1 flex-col bg-background",
            mobile && "mx-auto max-w-[390px] border-x"
          )}
          data-width={mobile ? "mobile" : "desktop"}
        >
          <PageFrame
            loads={loads}
            onNavigate={onNavigate}
            page={page}
            probe={probe}
            readFile={readFile}
            refreshKey={refreshKey}
            target={target}
          />
        </div>
      </div>
    </div>
  );
}

/** The toolbar's quieter actions, and whatever didn't fit in the row. */
function BrowserMenu({
  canGoForward: forwardEnabled,
  fit,
  mobile,
  newTab,
  onForward,
  onMobileChange,
  onReload,
}: {
  readonly canGoForward: boolean;
  readonly fit: ToolbarFit;
  readonly mobile: boolean;
  /** The served page's own URL; `null` for a static render (no origin to open). */
  readonly newTab: string | null;
  readonly onForward: () => void;
  readonly onMobileChange: (mobile: boolean) => void;
  readonly onReload: (() => void) | null;
}) {
  const { t } = useLingui();
  const moved = !(fit.forward && fit.reload);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            aria-label={t`More browser actions`}
            size="icon-sm"
            variant="ghost"
          />
        }
      >
        <EllipsisIcon aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        {fit.forward ? null : (
          <DropdownMenuItem disabled={!forwardEnabled} onClick={onForward}>
            <ArrowRightIcon aria-hidden />
            <Trans>Forward</Trans>
          </DropdownMenuItem>
        )}
        {fit.reload ? null : (
          <DropdownMenuItem
            disabled={!onReload}
            onClick={onReload ?? undefined}
          >
            <RefreshCwIcon aria-hidden />
            <Trans>Reload</Trans>
          </DropdownMenuItem>
        )}
        {moved ? <DropdownMenuSeparator /> : null}
        <DropdownMenuCheckboxItem
          checked={mobile}
          onCheckedChange={onMobileChange}
          title={t`Show the page at a phone's width`}
        >
          <Trans>Mobile width</Trans>
        </DropdownMenuCheckboxItem>
        {newTab ? (
          <DropdownMenuItem
            render={
              <a href={newTab} rel="noopener noreferrer" target="_blank" />
            }
          >
            <ExternalLinkIcon aria-hidden />
            <Trans>Open in a new tab</Trans>
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function AddressBar({
  onGo,
  path,
  staticLabel,
  target,
}: {
  readonly onGo: (path: string) => void;
  readonly path: string;
  /** Room for the words "Static render"; otherwise an icon says it. */
  readonly staticLabel: boolean;
  readonly target: PageTarget | null;
}) {
  const { t } = useLingui();
  const input = useRef<HTMLInputElement>(null);
  const [refused, setRefused] = useState(false);

  const submit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const next = readAddress(input.current?.value ?? "", target);
      if (next === null) {
        setRefused(true);
        return;
      }
      input.current?.blur();
      onGo(next);
    },
    [onGo, target]
  );
  // Escape puts the page's path back. With nothing to put back, it's the
  // panel's: it leaves the field, and the next one closes the panel.
  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (
        event.key === "Escape" &&
        input.current &&
        (input.current.value !== path || refused)
      ) {
        event.preventDefault();
        input.current.value = path;
        setRefused(false);
      }
    },
    [path, refused]
  );
  const clearRefusal = useCallback(() => setRefused(false), []);

  return (
    <form className="min-w-30 flex-1" onSubmit={submit}>
      <InputGroup className="h-7 border-transparent bg-muted dark:bg-muted">
        <InputGroupAddon>
          {target?.kind === "static-render" ? (
            <InputGroupText
              className="whitespace-nowrap text-xs"
              title={t`There's no server here, so the HTML file is shown as it is, with its local styles, scripts and images.`}
            >
              <FileIcon aria-hidden />
              <span className={staticLabel ? undefined : "sr-only"}>
                <Trans>Static render</Trans>
              </span>
            </InputGroupText>
          ) : (
            <InputGroupText className="font-mono text-xs">
              <GlobeIcon aria-hidden />
              {target?.kind === "server" ? `:${target.preview.port}` : null}
            </InputGroupText>
          )}
        </InputGroupAddon>
        <InputGroupInput
          aria-invalid={refused || undefined}
          aria-label={t`Address`}
          autoCapitalize="off"
          autoComplete="off"
          className="h-7 font-mono text-xs"
          defaultValue={path}
          disabled={target === null && path === ""}
          enterKeyHint="go"
          onChange={clearRefusal}
          onKeyDown={onKeyDown}
          ref={input}
          spellCheck={false}
          title={
            refused ? t`Only pages in this preview can open here.` : undefined
          }
        />
      </InputGroup>
    </form>
  );
}

function Centered({ children }: { readonly children: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-muted-foreground text-sm">
      {children}
    </div>
  );
}

function PageFrame({
  loads,
  onNavigate,
  page,
  probe,
  readFile,
  refreshKey,
  target,
}: {
  readonly loads: number;
  readonly onNavigate: (action: BrowserAction) => void;
  readonly page: BrowserPage | null;
  readonly probe: (url: string) => Promise<boolean>;
  readonly readFile: ReadStaticFile | null;
  readonly refreshKey: number | string;
  readonly target: PageTarget | null;
}) {
  if (!page) {
    return (
      <Centered>
        <p className="max-w-72">
          <Trans>
            Nothing to preview yet. Pages the agent writes and apps it starts
            show here.
          </Trans>
        </p>
      </Centered>
    );
  }
  if (!target) {
    const { path } = page;
    return (
      <Centered>
        <p className="max-w-72">
          <Trans>There's nothing to show at {path}.</Trans>
        </p>
      </Centered>
    );
  }
  if (target.kind === "server") {
    return (
      <ServedPage
        loads={loads}
        path={page.path}
        preview={target.preview}
        probe={probe}
      />
    );
  }
  return (
    <StaticPage
      loads={loads}
      onNavigate={onNavigate}
      path={page.path}
      readFile={readFile}
      refreshKey={refreshKey}
    />
  );
}

type Check = "checking" | "answering" | "silent";

/**
 * A page from a server in the sandbox. Before showing it, the panel checks
 * something answers, so an app that isn't running yet gets a sentence
 * instead of a proxy error.
 */
function ServedPage({
  loads,
  path,
  preview,
  probe,
}: {
  readonly loads: number;
  readonly path: string;
  readonly preview: SandboxPreview;
  readonly probe: (url: string) => Promise<boolean>;
}) {
  const { t } = useLingui();
  const [retries, setRetries] = useState(0);
  const [check, setCheck] = useState<Check>("checking");
  const { port } = preview;
  const url = pageUrl(preview, path);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `loads` and `retries` are Reload and Retry asking to check again.
  useEffect(() => {
    let current = true;
    setCheck("checking");
    probe(url).then(
      (answering) => {
        if (current) {
          setCheck(answering ? "answering" : "silent");
        }
      },
      () => {
        if (current) {
          setCheck("silent");
        }
      }
    );
    return () => {
      current = false;
    };
  }, [loads, probe, retries, url]);

  const again = useCallback(() => setRetries((count) => count + 1), []);

  switch (check) {
    case "checking":
      return (
        <div
          aria-busy
          className="flex flex-1 items-center justify-center gap-2 text-muted-foreground text-sm"
          role="status"
        >
          <Spinner />
          <Trans>Connecting to port {port}…</Trans>
        </div>
      );
    case "silent":
      return (
        <Centered>
          <p className="max-w-72">
            <Trans>
              Nothing is running on port {port} yet. Ask the agent to start the
              app.
            </Trans>
          </p>
          <Button onClick={again} size="sm" variant="outline">
            <Trans>Retry</Trans>
          </Button>
        </Centered>
      );
    case "answering":
      return (
        <iframe
          className="min-h-0 w-full flex-1 bg-background"
          key={`${url}#${loads}#${retries}`}
          referrerPolicy="no-referrer"
          sandbox={FRAME_SANDBOX}
          src={url}
          title={t`Preview of port ${port}`}
        />
      );
    default:
      return check satisfies never;
  }
}

type Render =
  | { readonly kind: "rendering" }
  | { readonly kind: "missing"; readonly file: string }
  | { readonly file: string; readonly html: string; readonly kind: "ready" };

const decodeText = (content: string, encoding: "utf8" | "base64") =>
  encoding === "utf8"
    ? content
    : new TextDecoder().decode(
        Uint8Array.from(atob(content), (char) => char.charCodeAt(0))
      );

/** An HTML file rendered in a `srcdoc` frame, for a workspace with no ports. */
function StaticPage({
  loads,
  onNavigate,
  path,
  readFile,
  refreshKey,
}: {
  readonly loads: number;
  readonly onNavigate: (action: BrowserAction) => void;
  readonly path: string;
  readonly readFile: ReadStaticFile | null;
  readonly refreshKey: number | string;
}) {
  const { t } = useLingui();
  const [render, setRender] = useState<Render>({ kind: "rendering" });
  const frame = useRef<HTMLIFrameElement>(null);
  const file = workspaceFileOf(path);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `loads` is Reload, `refreshKey` the agent changing files; both read the page again.
  useEffect(() => {
    if (!readFile) {
      setRender({ file, kind: "missing" });
      return;
    }
    let current = true;
    const read = async (): Promise<Render> => {
      const page = await readFile(file);
      if (!page.ok) {
        return { file, kind: "missing" };
      }
      const rendered = await renderStaticPage({
        html: decodeText(page.value.content, page.value.encoding),
        path: file,
        read: readFile,
      });
      return { file, html: rendered.html, kind: "ready" };
    };
    read().then(
      (next) => {
        if (current) {
          setRender(next);
        }
      },
      () => {
        if (current) {
          setRender({ file, kind: "missing" });
        }
      }
    );
    return () => {
      current = false;
    };
  }, [file, loads, readFile, refreshKey]);

  // Links in the page ask the panel to render the page they point to.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) {
        return;
      }
      const link = staticLinkMessageSchema.safeParse(event.data);
      const next = link.success ? resolveLink(path, link.data.href) : null;
      if (next) {
        onNavigate({ page: { path: next, port: null }, type: "navigate" });
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [onNavigate, path]);

  // Another page is on its way: don't leave the last one up meanwhile.
  const shown: Render =
    render.kind !== "rendering" && render.file !== file
      ? { kind: "rendering" }
      : render;
  switch (shown.kind) {
    case "rendering":
      return (
        <div
          aria-busy
          className="flex flex-1 items-center justify-center gap-2 text-muted-foreground text-sm"
          role="status"
        >
          <Spinner />
          <Trans>Rendering {file}…</Trans>
        </div>
      );
    case "missing": {
      const missing = shown.file;
      return (
        <Centered>
          <p className="max-w-72">
            <Trans>There's no {missing} in the workspace.</Trans>
          </p>
        </Centered>
      );
    }
    case "ready":
      return (
        <iframe
          className="min-h-0 w-full flex-1 bg-background"
          key={loads}
          ref={frame}
          referrerPolicy="no-referrer"
          sandbox={FRAME_SANDBOX}
          srcDoc={shown.html}
          title={t`Static render of ${file}`}
        />
      );
    default:
      return shown satisfies never;
  }
}

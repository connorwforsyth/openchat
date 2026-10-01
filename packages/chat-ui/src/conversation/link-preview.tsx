"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import {
  type LinkPreview,
  linkPreviewSchema,
} from "@workspace/contract/schemas/link-preview";
import { ExternalLinkIcon } from "@workspace/icons";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@workspace/ui/components/hover-card";
import { cn } from "@workspace/ui/lib/utils";
import {
  createContext,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

// Source chips with the site's favicon and a preview card (101). Previews
// come from our own server (`GET /api/link-preview`), never from the cited
// site, and their images from our signed image route. A chip loads its
// preview only when it comes near the viewport. Hover or focus opens the
// card; on touch, a tap opens it (it has an Open link) instead of leaving.

/** What a chip knows about its page. */
export type PreviewState =
  | { readonly status: "loading" }
  | { readonly status: "none" }
  /** Previews are off (or the reader isn't signed in): show the host, fetch nothing more. */
  | { readonly status: "off" }
  | { readonly preview: LinkPreview; readonly status: "ready" };

export type LinkPreviewLoader = (
  url: string
) => Promise<Exclude<PreviewState, { status: "loading" }>>;

const TRAILING_SLASH = /\/$/;

/**
 * Loads previews over HTTP, once per URL per page load. A 401 or 403
 * (signed out, or `features.linkPreviews` off) turns every later load into
 * `off` without a request.
 */
export const createHttpLinkPreviewLoader = ({
  baseUrl = "",
  fetch: fetchImpl = (...args) => fetch(...args),
}: {
  readonly baseUrl?: string;
  readonly fetch?: typeof fetch;
} = {}): LinkPreviewLoader => {
  const base = baseUrl.replace(TRAILING_SLASH, "");
  const loaded = new Map<string, ReturnType<LinkPreviewLoader>>();
  let off = false;
  const load: LinkPreviewLoader = async (url) => {
    if (off) {
      return { status: "off" };
    }
    let response: Response;
    try {
      response = await fetchImpl(
        `${base}/api/link-preview?url=${encodeURIComponent(url)}`,
        { credentials: "same-origin", headers: { accept: "application/json" } }
      );
    } catch {
      loaded.delete(url);
      return { status: "none" };
    }
    if (response.status === 401 || response.status === 403) {
      off = true;
      return { status: "off" };
    }
    if (!response.ok) {
      // A 404 is "no preview" for good; a 429 or 5xx may pass.
      if (response.status !== 404) {
        loaded.delete(url);
      }
      return { status: "none" };
    }
    const parsed = linkPreviewSchema.safeParse(
      await response.json().catch(() => null)
    );
    if (!parsed.success) {
      return { status: "none" };
    }
    // Image paths are on the API's origin.
    const preview = parsed.data;
    return {
      preview: base
        ? {
            ...preview,
            icon: preview.icon && `${base}${preview.icon}`,
            image: preview.image && {
              ...preview.image,
              url: `${base}${preview.image.url}`,
            },
          }
        : preview,
      status: "ready",
    };
  };
  return (url) => {
    const existing = loaded.get(url);
    if (existing) {
      return existing;
    }
    const started = load(url);
    loaded.set(url, started);
    return started;
  };
};

const LoaderContext = createContext<LinkPreviewLoader>(
  createHttpLinkPreviewLoader()
);

/** Swaps how previews load (tests, another API origin). */
export function LinkPreviewProvider({
  children,
  load,
}: {
  readonly children: ReactNode;
  readonly load: LinkPreviewLoader;
}) {
  return (
    <LoaderContext.Provider value={load}>{children}</LoaderContext.Provider>
  );
}

/** Starts once the element is within a screen's height of the viewport. */
const useNearViewport = <T extends Element>() => {
  const ref = useRef<T>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (near || !element) {
      return;
    }
    if (typeof IntersectionObserver === "undefined") {
      setNear(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNear(true);
        }
      },
      { rootMargin: "200px" }
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [near]);
  return { near, ref };
};

const usePreview = (url: string, near: boolean): PreviewState => {
  const load = useContext(LoaderContext);
  const [state, setState] = useState<PreviewState>({ status: "loading" });
  useEffect(() => {
    if (!near) {
      return;
    }
    let live = true;
    load(url).then(
      (next) => {
        if (live) {
          setState(next);
        }
      },
      () => {
        if (live) {
          setState({ status: "none" });
        }
      }
    );
    return () => {
      live = false;
    };
  }, [load, near, url]);
  return state;
};

type ImageStatus = "error" | "loaded" | "loading";

/**
 * Whether an image loads, found by loading it off-screen first, so a broken
 * icon never flashes and the fallback needs no error handler on the `<img>`.
 */
const useImageStatus = (src: string | undefined): ImageStatus => {
  const [status, setStatus] = useState<{ src?: string; value: ImageStatus }>({
    value: "loading",
  });
  useEffect(() => {
    if (!src) {
      return;
    }
    let live = true;
    const probe = new Image();
    probe.decoding = "async";
    probe.onload = () => live && setStatus({ src, value: "loaded" });
    probe.onerror = () => live && setStatus({ src, value: "error" });
    probe.src = src;
    return () => {
      live = false;
      probe.onload = null;
      probe.onerror = null;
    };
  }, [src]);
  if (!src) {
    return "error";
  }
  return status.src === src ? status.value : "loading";
};

const WWW = /^www\./;

export const hostOf = (url: string): string => {
  try {
    return new URL(url).host.replace(WWW, "");
  } catch {
    return url;
  }
};

/** The site's favicon at 16px, or its first letter when there's none. */
export function Favicon({
  className,
  host,
  src,
}: {
  readonly className?: string;
  readonly host: string;
  readonly src: string | undefined;
}) {
  const status = useImageStatus(src);
  const letter = (host.at(0) ?? "?").toUpperCase();
  if (status !== "loaded") {
    return (
      <span
        aria-hidden
        className={cn(
          "flex size-4 shrink-0 select-none items-center justify-center rounded-sm bg-muted font-medium text-[0.625rem] text-muted-foreground leading-none",
          className
        )}
        data-slot="favicon"
      >
        {letter}
      </span>
    );
  }
  return (
    // biome-ignore lint/performance/noImgElement: a same-origin 16px icon, not a page image
    <img
      alt=""
      className={cn("size-4 shrink-0 rounded-sm object-cover", className)}
      data-slot="favicon"
      decoding="async"
      height={16}
      src={src}
      width={16}
    />
  );
}

/** The card's 16:9 image, or the favicon blurred out behind a muted wash. */
function PreviewImage({
  host,
  preview,
}: {
  readonly host: string;
  readonly preview: LinkPreview;
}) {
  const status = useImageStatus(preview.image?.url);
  const image = status === "loaded" ? preview.image : undefined;
  return (
    <div
      className="relative aspect-video w-full overflow-hidden bg-muted"
      data-slot="link-preview-image"
    >
      {image ? (
        // biome-ignore lint/performance/noImgElement: served by our own image route, sized by its box
        <img
          alt={image.alt ?? ""}
          className="size-full object-cover"
          decoding="async"
          height={image.height}
          src={image.url}
          width={image.width}
        />
      ) : (
        <div
          aria-hidden
          className="flex size-full items-center justify-center"
          data-fallback=""
        >
          <Favicon
            className="size-24 scale-150 rounded-none opacity-40 blur-2xl"
            host={host}
            src={preview.icon}
          />
        </div>
      )}
    </div>
  );
}

const CARD_TEXT =
  "flex flex-col gap-1.5 p-3 text-start outline-none focus-visible:bg-muted/50";

/** The card's contents: the page's image, site, title and description. */
export function LinkPreviewCard({
  preview,
  url,
}: {
  readonly preview: LinkPreview;
  readonly url: string;
}) {
  const host = hostOf(preview.finalUrl);
  const site = preview.siteName ?? host;
  return (
    <div className="flex flex-col" data-slot="link-preview-card">
      <a
        className="flex flex-col"
        href={url}
        rel="noopener noreferrer"
        tabIndex={-1}
        target="_blank"
      >
        <PreviewImage host={host} preview={preview} />
        <span className={CARD_TEXT}>
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <Favicon host={host} src={preview.icon} />
            <span className="truncate">{site}</span>
          </span>
          {preview.title ? (
            <span className="line-clamp-2 font-medium text-foreground text-sm leading-snug">
              {preview.title}
            </span>
          ) : null}
          {preview.description ? (
            <span className="line-clamp-2 text-muted-foreground">
              {preview.description}
            </span>
          ) : null}
        </span>
      </a>
      <div className="flex items-center justify-between gap-2 border-t px-3 py-2 text-muted-foreground">
        <span className="truncate">{host}</span>
        <a
          className="flex shrink-0 items-center gap-1 rounded-sm font-medium text-foreground outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
          href={url}
          rel="noopener noreferrer"
          target="_blank"
        >
          <Trans>Open</Trans>
          <ExternalLinkIcon aria-hidden className="size-3" />
        </a>
      </div>
    </div>
  );
}

const CHIP =
  "flex max-w-64 items-center gap-1.5 rounded-md border px-2 py-1 text-xs outline-none transition-colors duration-(--motion-fast) hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50";

/**
 * A web source: its number, favicon and site, opening the page in a new
 * tab. With a preview, hovering or focusing it opens the card.
 */
export function UrlSourceChip({
  number,
  title,
  url,
}: {
  readonly number: number;
  readonly title: string | undefined;
  readonly url: string;
}) {
  const { t } = useLingui();
  const { near, ref } = useNearViewport<HTMLAnchorElement>();
  const state = usePreview(url, near);
  const [open, setOpen] = useState(false);
  const pointer = useRef<string>("mouse");
  // A tap shows the card first; its Open link (or a second tap) leaves.
  const onClick = useCallback(
    (event: MouseEvent<HTMLAnchorElement>) => {
      if (pointer.current === "touch" && !open) {
        event.preventDefault();
        setOpen(true);
      }
    },
    [open]
  );
  const onPointerDown = useCallback((event: PointerEvent<HTMLElement>) => {
    pointer.current = event.pointerType;
  }, []);
  const host = hostOf(url);
  const preview = state.status === "ready" ? state.preview : undefined;
  const site = preview?.siteName ?? host;
  const name = preview?.title ?? title;
  const content = (
    <>
      <span className="text-muted-foreground tabular-nums">{number}</span>
      {state.status === "off" ? null : (
        <Favicon host={host} src={preview?.icon} />
      )}
      <span className="truncate">{site}</span>
      {name && name !== site ? (
        <span className="sr-only">{t`Page: ${name}`}</span>
      ) : null}
      <ExternalLinkIcon aria-hidden className="size-3 shrink-0" />
    </>
  );
  if (!preview) {
    return (
      <a
        className={CHIP}
        data-preview={state.status}
        href={url}
        ref={ref}
        rel="noopener noreferrer"
        target="_blank"
        title={name}
      >
        {content}
      </a>
    );
  }
  return (
    <HoverCard onOpenChange={setOpen} open={open}>
      <HoverCardTrigger
        className={CHIP}
        closeDelay={150}
        data-preview="ready"
        delay={300}
        href={url}
        onClick={onClick}
        onPointerDown={onPointerDown}
        ref={ref}
        rel="noopener noreferrer"
        target="_blank"
      >
        {content}
      </HoverCardTrigger>
      <HoverCardContent
        align="start"
        className="w-72 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl p-0 text-xs"
        side="top"
      >
        <LinkPreviewCard preview={preview} url={url} />
      </HoverCardContent>
    </HoverCard>
  );
}

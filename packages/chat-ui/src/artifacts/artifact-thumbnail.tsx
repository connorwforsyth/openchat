"use client";

import type { ArtifactKind } from "@workspace/contract/schemas/message-parts";
import { useCallback, useState } from "react";

import { KindIcon } from "./kind-icon";

// The picture on an Artifacts page grid card (161): the runtime's render of
// the artifact when there's one to show, the kind's icon otherwise, and the
// icon again if the picture doesn't load. The picture is decorative (the
// card's title is its name), and lazy, so a long grid fetches what's on
// screen.

export function ArtifactThumbnail({
  kind,
  src,
}: {
  readonly kind: ArtifactKind;
  /** Where the picture is, or `null` for the icon. */
  readonly src: string | null;
}) {
  // Keyed by `src`: a new version's picture gets its own try.
  const [failed, setFailed] = useState<string | null>(null);
  const fail = useCallback(() => setFailed(src), [src]);
  const showImage = src !== null && failed !== src;
  return (
    <div
      className="flex aspect-1200/630 items-center justify-center overflow-hidden rounded-lg bg-muted"
      data-thumbnail={showImage ? "image" : "icon"}
    >
      {showImage ? (
        // biome-ignore lint/performance/noImgElement: chat-ui is framework-agnostic, so next/image isn't available here.
        // biome-ignore lint/a11y/noNoninteractiveElementInteractions: `onError` is the load failing, not an interaction; it swaps in the icon.
        <img
          alt=""
          className="size-full object-cover object-top"
          decoding="async"
          height={630}
          loading="lazy"
          onError={fail}
          referrerPolicy="no-referrer"
          src={src}
          width={1200}
        />
      ) : (
        <KindIcon className="size-8 text-muted-foreground" kind={kind} />
      )}
    </div>
  );
}

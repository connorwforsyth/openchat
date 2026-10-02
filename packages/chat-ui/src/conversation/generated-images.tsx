"use client";

import { Plural, Trans, useLingui } from "@lingui/react/macro";
import type { GeneratedImage } from "@workspace/ai/tools/image-generation";
import { DownloadIcon, ImageIcon, PencilIcon } from "@workspace/icons";
import { Button, buttonVariants } from "@workspace/ui/components/button";
import { useCallback } from "react";

import type { ToolDetail } from "../model/tool-summary";
import { useConversationActions } from "./actions";

// What `generate_image` made (138), in the reply: each picture with a
// download and "Edit this image", which puts a follow-up in the composer
// that names the picture's workspace path, so the next call edits it. The
// bytes come from the image's artifact; a view that can't serve them (a
// shared link) lists the pictures by name instead.

type ImagesDetail = Extract<ToolDetail, { kind: "image" }>;

const EXTENSIONS: Readonly<Record<string, string>> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const SLASH = /^.*\//;

/** The name a picture downloads as: its workspace file's, else its title's. */
const downloadName = (image: GeneratedImage): string =>
  image.path?.replace(SLASH, "") ??
  `${image.artifact?.title ?? "image"}.${EXTENSIONS[image.mediaType] ?? "png"}`;

function GeneratedPicture({
  image,
  prompt,
}: {
  readonly image: GeneratedImage;
  readonly prompt: string;
}) {
  const { t } = useLingui();
  const { artifactImageUrl, onEditImage } = useConversationActions();
  const { artifact, path } = image;
  const url =
    artifact && artifactImageUrl
      ? artifactImageUrl(artifact.artifactId, artifact.versionId)
      : undefined;
  const name = downloadName(image);
  const edit = useCallback(() => {
    if (path) {
      onEditImage?.({ path, prompt });
    }
  }, [onEditImage, path, prompt]);
  return (
    <figure className="flex w-full max-w-sm flex-col gap-2">
      {url ? (
        /* biome-ignore lint/performance/noImgElement: chat-ui is framework-agnostic, so next/image isn't available here. */
        /* biome-ignore lint/correctness/useImageSize: its size is the model's; it's fitted by CSS. */
        <img
          alt={artifact?.title ?? prompt}
          className="aspect-square w-full rounded-lg border border-border bg-muted object-contain"
          loading="lazy"
          src={url}
        />
      ) : (
        <div className="flex aspect-square w-full items-center justify-center rounded-lg border border-border bg-muted text-muted-foreground">
          <ImageIcon aria-hidden className="size-8" />
        </div>
      )}
      <figcaption className="flex flex-wrap items-center gap-2">
        {path ? (
          <code className="me-auto truncate text-muted-foreground text-xs">
            {path}
          </code>
        ) : null}
        {url ? (
          <a
            aria-label={t`Download ${name}`}
            className={buttonVariants({ size: "sm", variant: "outline" })}
            download={name}
            href={url}
          >
            <DownloadIcon aria-hidden />
            <Trans>Download</Trans>
          </a>
        ) : null}
        {path && onEditImage ? (
          <Button onClick={edit} size="sm" variant="outline">
            <PencilIcon aria-hidden />
            <Trans>Edit this image</Trans>
          </Button>
        ) : null}
      </figcaption>
    </figure>
  );
}

/** The pictures one `generate_image` call made. */
export function GeneratedImages({ detail }: { readonly detail: ImagesDetail }) {
  const { t } = useLingui();
  const count = detail.images.length;
  return (
    <section
      aria-label={t`Generated images`}
      className="flex flex-col gap-2"
      data-slot="generated-images"
    >
      <p className="flex items-center gap-2 text-muted-foreground text-sm">
        <ImageIcon aria-hidden className="size-4 shrink-0" />
        <Plural one="Made an image" other="Made # images" value={count} />
      </p>
      <div className="flex flex-wrap gap-3">
        {detail.images.map((image, index) => (
          <GeneratedPicture
            image={image}
            key={image.artifact?.versionId ?? image.path ?? index}
            prompt={detail.prompt}
          />
        ))}
      </div>
    </section>
  );
}

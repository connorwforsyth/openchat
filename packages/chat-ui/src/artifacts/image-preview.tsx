"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import { DownloadIcon } from "@workspace/icons";
import { buttonVariants } from "@workspace/ui/components/button";

/**
 * An image artifact (138) in the panel and on the Artifacts page: the
 * picture, fitted, with a download. A version's content is the image as a
 * data: URL, so it shows without another request.
 */
export function ImageArtifactPreview({
  content,
  fileName,
  title,
}: {
  readonly content: string;
  readonly fileName: string;
  readonly title: string;
}) {
  const { t } = useLingui();
  return (
    <figure className="flex min-h-0 flex-1 flex-col items-center gap-3 p-4">
      {/* biome-ignore lint/performance/noImgElement: chat-ui is framework-agnostic, so next/image isn't available here. */}
      {/* biome-ignore lint/correctness/useImageSize: its size is the model's; it's fitted by CSS. */}
      <img
        alt={title}
        className="max-h-[70vh] max-w-full rounded-md border border-border object-contain"
        src={content}
      />
      <a
        aria-label={t`Download ${fileName}`}
        className={buttonVariants({ size: "sm", variant: "outline" })}
        download={fileName}
        href={content}
      >
        <DownloadIcon aria-hidden />
        <Trans>Download</Trans>
      </a>
    </figure>
  );
}

"use client";

import { useLingui } from "@lingui/react/macro";
import { FileIcon } from "@workspace/icons";

import type { FilePart } from "../model/parts";
import { useConversationActions } from "./actions";

/** Files attached to or produced in a message: image thumbnails, other files as chips. */
export function FileParts({ files }: { readonly files: readonly FilePart[] }) {
  const { t } = useLingui();
  const { fileUrl } = useConversationActions();
  return (
    <ul aria-label={t`Attachments`} className="flex flex-wrap gap-2">
      {files.map((file, index) => {
        const url =
          file.source.kind === "url"
            ? file.source.url
            : fileUrl?.(file.source.fileId);
        const name = file.filename ?? t`Attachment`;
        const key = `${file.filename ?? file.mediaType}-${index}`;
        if (file.mediaType.startsWith("image/") && url) {
          return (
            <li key={key}>
              <a href={url} rel="noopener" target="_blank">
                {/* biome-ignore lint/performance/noImgElement: chat-ui is framework-agnostic, so next/image isn't available here. */}
                <img
                  alt={name}
                  className="size-24 rounded-lg border object-cover"
                  height={96}
                  loading="lazy"
                  src={url}
                  width={96}
                />
              </a>
            </li>
          );
        }
        const chip = (
          <>
            <FileIcon
              aria-hidden
              className="size-4 shrink-0 text-muted-foreground"
            />
            <span className="truncate">{name}</span>
          </>
        );
        return (
          <li key={key}>
            {url ? (
              <a
                className="flex max-w-64 items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm transition-colors duration-(--motion-fast) hover:bg-muted"
                href={url}
              >
                {chip}
              </a>
            ) : (
              <span className="flex max-w-64 items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm">
                {chip}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

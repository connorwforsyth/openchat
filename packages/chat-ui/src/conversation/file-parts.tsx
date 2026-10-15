"use client";

import { useLingui } from "@lingui/react/macro";
import { FileIcon } from "@workspace/icons";
import {
  Attachment,
  AttachmentContent,
  AttachmentMedia,
  AttachmentTitle,
  AttachmentTrigger,
} from "@workspace/ui/components/attachment";

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
        return (
          <li className="max-w-64" key={key}>
            <Attachment size="sm">
              <AttachmentMedia>
                <FileIcon aria-hidden className="text-muted-foreground" />
              </AttachmentMedia>
              <AttachmentContent>
                <AttachmentTitle>{name}</AttachmentTitle>
              </AttachmentContent>
              {/* The whole chip is the link; the trigger covers it. */}
              {url ? (
                <AttachmentTrigger
                  aria-label={name}
                  render={<a href={url} />}
                />
              ) : null}
            </Attachment>
          </li>
        );
      })}
    </ul>
  );
}

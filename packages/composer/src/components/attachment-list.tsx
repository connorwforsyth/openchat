"use client";

import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { formatFileSize } from "@workspace/i18n/format";
import { FileIcon, XIcon } from "@workspace/icons";
import { Button } from "@workspace/ui/components/button";
import { useCallback, useEffect, useState } from "react";

import type { AttachmentRejection, ComposerAttachment } from "../schemas";

export interface AttachmentListProps {
  readonly attachments: readonly ComposerAttachment[];
  readonly disabled?: boolean;
  readonly onRemove: (id: string) => void;
}

/** A thumbnail for images; the object URL lives exactly as long as the chip. */
function AttachmentPreview({ file }: { readonly file: File }) {
  const [url, setUrl] = useState<string | null>(null);
  const isImage = file.type.startsWith("image/");

  useEffect(() => {
    if (!isImage) {
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file, isImage]);

  if (url === null) {
    return <FileIcon aria-hidden className="size-4 text-muted-foreground" />;
  }
  return (
    // biome-ignore lint/performance/noImgElement: the composer is framework-agnostic, so next/image isn't available; this is a 20px local preview.
    <img
      alt=""
      className="size-5 rounded-sm object-cover"
      height={20}
      src={url}
      width={20}
    />
  );
}

interface AttachmentChipProps {
  readonly disabled: boolean | undefined;
  readonly file: File;
  readonly id: string;
  readonly onRemove: (id: string) => void;
}

function AttachmentChip({ disabled, file, id, onRemove }: AttachmentChipProps) {
  const { i18n, t } = useLingui();
  const { name, size } = file;
  const handleRemove = useCallback(() => onRemove(id), [id, onRemove]);
  return (
    <li className="flex h-8 max-w-56 items-center gap-1.5 rounded-md border border-border bg-background ps-1.5 pe-0.5 text-foreground text-sm">
      <AttachmentPreview file={file} />
      <span className="truncate">{name}</span>
      <span className="shrink-0 text-muted-foreground text-xs">
        {formatFileSize(size, i18n.locale)}
      </span>
      <Button
        aria-label={t`Remove ${name}`}
        disabled={disabled}
        onClick={handleRemove}
        size="icon-xs"
        type="button"
        variant="ghost"
      >
        <XIcon aria-hidden />
      </Button>
    </li>
  );
}

export function AttachmentList({
  attachments,
  disabled,
  onRemove,
}: AttachmentListProps) {
  const { t } = useLingui();
  if (attachments.length === 0) {
    return null;
  }
  return (
    <ul aria-label={t`Attachments`} className="flex w-full flex-wrap gap-1.5">
      {attachments.map(({ file, id }) => (
        <AttachmentChip
          disabled={disabled}
          file={file}
          id={id}
          key={id}
          onRemove={onRemove}
        />
      ))}
    </ul>
  );
}

/** One sentence for a file that wasn't attached. */
export function RejectionMessage({
  rejection,
}: {
  readonly rejection: AttachmentRejection;
}) {
  const { i18n } = useLingui();
  const { fileName } = rejection;
  switch (rejection.code) {
    case "type":
      return <Trans>{fileName} isn't a supported file type.</Trans>;
    case "size": {
      const limit = formatFileSize(rejection.maxFileSize, i18n.locale);
      return (
        <Trans>
          {fileName} is larger than {limit}.
        </Trans>
      );
    }
    case "count": {
      const { maxFiles } = rejection;
      return (
        <Plural
          one={`${fileName} wasn't added: you can attach # file.`}
          other={`${fileName} wasn't added: you can attach up to # files.`}
          value={maxFiles}
        />
      );
    }
    default:
      return rejection satisfies never;
  }
}

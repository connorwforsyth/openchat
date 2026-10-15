"use client";

import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { formatFileSize } from "@workspace/i18n/format";
import { FileIcon, XIcon } from "@workspace/icons";
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
} from "@workspace/ui/components/attachment";
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
    return (
      <AttachmentMedia>
        <FileIcon aria-hidden className="text-muted-foreground" />
      </AttachmentMedia>
    );
  }
  return (
    <AttachmentMedia variant="image">
      {/* biome-ignore lint/performance/noImgElement: the composer is framework-agnostic, so next/image isn't available; this is a 32px local preview. */}
      <img alt="" height={32} src={url} width={32} />
    </AttachmentMedia>
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
    <li className="max-w-56">
      <Attachment size="sm">
        <AttachmentPreview file={file} />
        <AttachmentContent>
          <AttachmentTitle>{name}</AttachmentTitle>
          <AttachmentDescription>
            {formatFileSize(size, i18n.locale)}
          </AttachmentDescription>
        </AttachmentContent>
        <AttachmentActions>
          <AttachmentAction
            aria-label={t`Remove ${name}`}
            disabled={disabled}
            onClick={handleRemove}
          >
            <XIcon aria-hidden />
          </AttachmentAction>
        </AttachmentActions>
      </Attachment>
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

"use client";

import { useCallback, useId, useRef, useState } from "react";

import { admitFiles } from "../attachments";
import type {
  AttachmentLimits,
  AttachmentRejection,
  ComposerAttachment,
} from "../schemas";

const NONE: readonly never[] = [];

export interface UseAttachmentsOptions {
  readonly disabled: boolean;
  readonly limits: AttachmentLimits;
  readonly onChange?: (attachments: readonly ComposerAttachment[]) => void;
  readonly onRejected?: (rejections: readonly AttachmentRejection[]) => void;
}

/** The draft's files, and why the last files offered weren't taken. */
export function useAttachments({
  disabled,
  limits,
  onChange,
  onRejected,
}: UseAttachmentsOptions) {
  const baseId = useId();
  const counter = useRef(0);
  const [attachments, setAttachments] =
    useState<readonly ComposerAttachment[]>(NONE);
  const [rejections, setRejections] =
    useState<readonly AttachmentRejection[]>(NONE);

  const update = useCallback(
    (next: readonly ComposerAttachment[]) => {
      setAttachments(next);
      onChange?.(next);
    },
    [onChange]
  );

  const add = useCallback(
    (files: readonly File[]) => {
      if (disabled || files.length === 0) {
        return;
      }
      const { accepted, rejected } = admitFiles(
        attachments.length,
        files,
        limits
      );
      if (accepted.length > 0) {
        const added = accepted.map((file) => {
          counter.current += 1;
          return { file, id: `${baseId}-file-${counter.current}` };
        });
        update([...attachments, ...added]);
      }
      setRejections(rejected);
      if (rejected.length > 0) {
        onRejected?.(rejected);
      }
    },
    [attachments, baseId, disabled, limits, onRejected, update]
  );

  const remove = useCallback(
    (id: string) => {
      update(attachments.filter((attachment) => attachment.id !== id));
      setRejections(NONE);
    },
    [attachments, update]
  );

  const clear = useCallback(() => {
    update(NONE);
    setRejections(NONE);
  }, [update]);

  const atLimit =
    limits.maxFiles !== undefined && attachments.length >= limits.maxFiles;

  return { add, atLimit, attachments, clear, rejections, remove };
}

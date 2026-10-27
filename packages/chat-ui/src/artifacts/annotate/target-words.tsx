"use client";

import type { I18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import type {
  AnnotationsData,
  AnnotationTarget,
} from "@workspace/ai/messages/annotations";

/** What a note points at, in a few words. */
export const targetText = (target: AnnotationTarget, i18n: I18n): string => {
  switch (target.type) {
    case "element":
      return target.text ? i18n._(msg`“${target.text}”`) : target.selector;
    case "slide":
      return target.text
        ? i18n._(msg`Slide ${target.slide}: “${target.text}”`)
        : i18n._(msg`Slide ${target.slide}`);
    case "cells":
      return target.sheet
        ? i18n._(msg`Cells ${target.range} on ${target.sheet}`)
        : i18n._(msg`Cells ${target.range}`);
    case "node":
      return i18n._(msg`Node ${target.label ?? target.id}`);
    case "text":
      return i18n._(msg`“${target.text}”`);
    case "lines":
      return target.start === target.end
        ? i18n._(msg`Line ${target.start}`)
        : i18n._(msg`Lines ${target.start} to ${target.end}`);
    case "box":
      return i18n._(msg`Part of the image`);
    default:
      return target satisfies never;
  }
};

/**
 * Sent notes as people read them, one line each ("• where: note"), for
 * copying a notes message instead of the block the model read.
 */
export const notesText = (data: AnnotationsData, i18n: I18n): string =>
  data.notes
    .map((note) =>
      note.target
        ? `• ${targetText(note.target, i18n)}: ${note.note}`
        : `• ${note.note}`
    )
    .join("\n");

/** The pin's note and the sent card say what a note points at. */
export function TargetWords({ target }: { readonly target: AnnotationTarget }) {
  const { i18n } = useLingui();
  return targetText(target, i18n);
}

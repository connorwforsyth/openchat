"use client";

import { useLingui } from "@lingui/react/macro";
import type { AnnotationTarget } from "@workspace/ai/messages/annotations";

/** What a note points at, in a few words: the pin's note and the sent card. */
export function TargetWords({ target }: { readonly target: AnnotationTarget }) {
  const { t } = useLingui();
  switch (target.type) {
    case "element":
      return target.text ? t`“${target.text}”` : target.selector;
    case "slide":
      return target.text
        ? t`Slide ${target.slide}: “${target.text}”`
        : t`Slide ${target.slide}`;
    case "cells":
      return target.sheet
        ? t`Cells ${target.range} on ${target.sheet}`
        : t`Cells ${target.range}`;
    case "node":
      return t`Node ${target.label ?? target.id}`;
    case "text":
      return t`“${target.text}”`;
    case "lines":
      return target.start === target.end
        ? t`Line ${target.start}`
        : t`Lines ${target.start} to ${target.end}`;
    case "box":
      return t`Part of the image`;
    default:
      return target satisfies never;
  }
}

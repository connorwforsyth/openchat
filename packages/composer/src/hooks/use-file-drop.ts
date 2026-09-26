"use client";

import { type DragEvent, useCallback, useState } from "react";

const hasFiles = (event: DragEvent) =>
  event.dataTransfer.types.includes("Files");

/**
 * Drag and drop of files onto an element. Other drags (text, links) pass
 * through untouched, so dropping a selection into the textarea still works.
 */
export function useFileDrop(
  onFiles: (files: readonly File[]) => void,
  disabled: boolean
) {
  const [dragging, setDragging] = useState(false);

  const onDragOver = useCallback(
    (event: DragEvent<HTMLElement>) => {
      if (!disabled && hasFiles(event)) {
        event.preventDefault();
        setDragging(true);
      }
    },
    [disabled]
  );

  const onDragLeave = useCallback((event: DragEvent<HTMLElement>) => {
    // Moving onto a child still counts as over the element.
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setDragging(false);
    }
  }, []);

  const onDrop = useCallback(
    (event: DragEvent<HTMLElement>) => {
      if (!hasFiles(event)) {
        return;
      }
      event.preventDefault();
      setDragging(false);
      onFiles(Array.from(event.dataTransfer.files));
    },
    [onFiles]
  );

  return { dragging, handlers: { onDragLeave, onDragOver, onDrop } };
}

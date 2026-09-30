"use client";

import { useLayoutEffect, useState } from "react";

// An element's width as it changes (the panel resizes). The Workspace
// decides a few things by width that CSS alone can't: which of list and main
// shows on a narrow panel (keyboard focus follows it) and what goes into the
// Preview toolbar's menu (a menu's popup is outside any container query).

/** A callback ref and the element's border-box width; 0 until measured. */
export function useElementWidth<T extends HTMLElement>(): readonly [
  (node: T | null) => void,
  number,
] {
  const [node, setNode] = useState<T | null>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    if (!node) {
      return;
    }
    // Before paint, so the first frame is already laid out for the width.
    setWidth(Math.round(node.getBoundingClientRect().width));
    const observer = new ResizeObserver(([entry]) => {
      const size = entry?.borderBoxSize[0]?.inlineSize;
      if (size !== undefined) {
        setWidth(Math.round(size));
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);
  return [setNode, width];
}

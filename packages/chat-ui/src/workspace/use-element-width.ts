"use client";

import { useLayoutEffect, useState } from "react";

// An element's width as it changes (the panel resizes). The Workspace
// decides a few things by width that CSS alone can't: which of list and main
// shows on a narrow panel (keyboard focus follows it) and what goes into the
// Preview toolbar's menu (a menu's popup is outside any container query).

/** A callback ref and the element's border-box width; 0 until measured. */
export const useElementWidth = <T extends HTMLElement>() =>
  useElementSize<T>("inline");

/** The same for its height (the browser and the files share it, 097). */
export const useElementHeight = <T extends HTMLElement>() =>
  useElementSize<T>("block");

function useElementSize<T extends HTMLElement>(
  axis: "block" | "inline"
): readonly [(node: T | null) => void, number] {
  const [node, setNode] = useState<T | null>(null);
  const [size, setSize] = useState(0);
  useLayoutEffect(() => {
    if (!node) {
      return;
    }
    // Before paint, so the first frame is already laid out for the size.
    const box = node.getBoundingClientRect();
    setSize(Math.round(axis === "inline" ? box.width : box.height));
    const observer = new ResizeObserver(([entry]) => {
      const border = entry?.borderBoxSize[0];
      const measured =
        axis === "inline" ? border?.inlineSize : border?.blockSize;
      if (measured !== undefined) {
        setSize(Math.round(measured));
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [axis, node]);
  return [setNode, size];
}

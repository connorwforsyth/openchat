import { isValidElement, type ReactNode } from "react";

// What a list prop holds, as points a layout can draw (n2). Slides are
// written by models, and a small one passes `items` as one string, or as
// objects ({ text }) where React wants nodes; React throws on an object
// child, which takes the whole slide down. A layout draws what it can.

const LINE = /\r?\n/;
const TEXT_KEYS = ["text", "title", "label", "name", "content"] as const;

/** One point as something React can draw. */
export const pointOf = (item: unknown): ReactNode => {
  if (
    item === null ||
    item === undefined ||
    typeof item === "string" ||
    typeof item === "number" ||
    typeof item === "boolean" ||
    isValidElement(item)
  ) {
    return item as ReactNode;
  }
  if (Array.isArray(item)) {
    return item.map(pointOf).join(" ");
  }
  if (typeof item === "object") {
    for (const key of TEXT_KEYS) {
      const value = (item as Record<string, unknown>)[key];
      if (typeof value === "string" || typeof value === "number") {
        return String(value);
      }
    }
  }
  return JSON.stringify(item);
};

/** A list prop as points: an array as it is, one string a point a line. */
export const pointsOf = (items: unknown): ReactNode[] => {
  if (Array.isArray(items)) {
    return items.map(pointOf);
  }
  if (typeof items === "string") {
    return items
      .split(LINE)
      .map((line) => line.trim())
      .filter(Boolean);
  }
  return items === null || items === undefined ? [] : [pointOf(items)];
};

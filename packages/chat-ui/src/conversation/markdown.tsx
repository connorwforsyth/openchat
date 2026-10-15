"use client";

import { Markdown as StreamdownMarkdown } from "@workspace/ui/components/markdown";
import { useEffect, useState } from "react";

import { codePlugin } from "./code-plugin";

type MathPlugin = Awaited<typeof import("./math-plugin")>["math"];

// `$$…$$`, `\[…\]` and `\(…\)`; single dollars are prices far more often
// than maths, so they stay text (Streamdown's default too).
const MATH = /\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)/;

export const hasMath = (text: string): boolean => MATH.test(text);

// Stable objects, so Markdown's memo sees the same plugins each chunk.
const codeOnly = { code: codePlugin } as const;
let withMath: {
  readonly code: typeof codePlugin;
  readonly math: MathPlugin;
} | null = null;
const plugins = (math: MathPlugin | null) => {
  if (!math) {
    return codeOnly;
  }
  withMath ??= { code: codePlugin, math };
  return withMath;
};

// A code block's body stays hidden, keeping its height, until the code plugin
// has coloured it, so plain text never flashes before the highlighted
// version. It then appears at once (D28: opacity only, appear instantly).
// Spelled out in full (the marker is CODE_READY_ATTRIBUTE) so Tailwind's
// scanner finds the class.
const HIDE_UNCOLOURED_CODE =
  "[&_[data-streamdown=code-block-body]:not(:has([data-code-ready]))]:opacity-0";

let mathLoad: Promise<MathPlugin> | null = null;
/** One import for the whole page, however many messages need it. */
const loadMath = (): Promise<MathPlugin> => {
  mathLoad ??= import("./math-plugin").then((module) => module.math);
  return mathLoad;
};

/**
 * Model output as markdown (Streamdown handles unfinished fences and tables
 * while streaming). Maths renders once the KaTeX chunk arrives; until then
 * the source shows, which is what a failed load leaves too. Fenced code is
 * highlighted by the code plugin, which loads Shiki on the first fence.
 */
export function Markdown({
  children,
  streaming = false,
}: {
  readonly children: string;
  readonly streaming?: boolean;
}) {
  const needsMath = hasMath(children);
  const [math, setMath] = useState<MathPlugin | null>(null);

  useEffect(() => {
    if (!needsMath || math) {
      return;
    }
    let current = true;
    loadMath().then(
      (plugin) => {
        if (current) {
          setMath(plugin);
        }
      },
      () => {
        // Leave the TeX source visible rather than break the message.
      }
    );
    return () => {
      current = false;
    };
  }, [math, needsMath]);

  return (
    <StreamdownMarkdown
      className={HIDE_UNCOLOURED_CODE}
      isAnimating={streaming}
      // It re-renders only when its text changes; the key makes the arrival
      // of the math plugin count too.
      key={math ? "math" : "plain"}
      plugins={plugins(math)}
    >
      {children}
    </StreamdownMarkdown>
  );
}

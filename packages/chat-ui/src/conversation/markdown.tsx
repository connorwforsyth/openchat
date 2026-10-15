"use client";

import { Markdown as StreamdownMarkdown } from "@workspace/ui/components/markdown";
import { useEffect, useState } from "react";

type MathPlugin = Awaited<typeof import("./math-plugin")>["math"];

// `$$…$$`, `\[…\]` and `\(…\)`; single dollars are prices far more often
// than maths, so they stay text (Streamdown's default too).
const MATH = /\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)/;

export const hasMath = (text: string): boolean => MATH.test(text);

let mathLoad: Promise<MathPlugin> | null = null;
/** One import for the whole page, however many messages need it. */
const loadMath = (): Promise<MathPlugin> => {
  mathLoad ??= import("./math-plugin").then((module) => module.math);
  return mathLoad;
};

/**
 * Model output as markdown (Streamdown handles unfinished fences and tables
 * while streaming). Maths renders once the KaTeX chunk arrives; until then
 * the source shows, which is what a failed load leaves too.
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
      isAnimating={streaming}
      // It re-renders only when its text changes; the key makes the arrival
      // of the math plugin count too.
      key={math ? "math" : "plain"}
      plugins={math ? { math } : undefined}
    >
      {children}
    </StreamdownMarkdown>
  );
}

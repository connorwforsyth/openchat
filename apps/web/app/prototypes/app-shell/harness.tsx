// biome-ignore-all lint/performance/noJsxPropsBind: a throwaway prototype (ticket 009); inline handlers keep each variant readable and it is deleted once a direction is picked.
"use client";

// The prototype picker harness (prototype skill, PICKER.md): one variant at a
// time, full viewport, switched instantly. The picker's markup, classes and
// behaviour follow the spec; only the rendering is React.
import { TooltipProvider } from "@workspace/ui/components/tooltip";
import {
  type ComponentType,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { ClassicShell } from "./classic";
import { FocusShell } from "./focus";
import "./picker.css";
import { isTypingTarget } from "./shared";
import { WorkspaceShell } from "./workspace";

const variants: readonly { name: string; Component: ComponentType }[] = [
  { Component: ClassicShell, name: "Classic" },
  { Component: WorkspaceShell, name: "Workspace" },
  { Component: FocusShell, name: "Focus" },
];

const clamp = (index: number) =>
  Number.isInteger(index) && index >= 0 && index < variants.length ? index : 0;

/** Number keys pick a variant; the arrows step through them, wrapping. */
const targetIndex = (key: string, current: number): number | null => {
  const num = Number.parseInt(key, 10);
  if (num >= 1 && num <= variants.length) {
    return num - 1;
  }
  if (key === "ArrowRight") {
    return (current + 1) % variants.length;
  }
  if (key === "ArrowLeft") {
    return (current - 1 + variants.length) % variants.length;
  }
  return null;
};

export const Harness = ({ initial }: { initial: number }) => {
  const [current, setCurrent] = useState(() => clamp(initial));
  // Bumped to re-mount the variant without switching (the R key).
  const [mountKey, setMountKey] = useState(0);
  const [ready, setReady] = useState(false);
  const pickerRef = useRef<HTMLElement>(null);
  const highlightRef = useRef<HTMLSpanElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const moveHighlight = useCallback(() => {
    const el = itemRefs.current[current];
    const highlight = highlightRef.current;
    if (!(el && highlight)) {
      return;
    }
    highlight.style.width = `${el.offsetWidth}px`;
    highlight.style.transform = `translateX(${el.offsetLeft}px)`;
  }, [current]);

  useLayoutEffect(() => {
    moveHighlight();
  }, [moveHighlight]);

  useEffect(() => {
    window.addEventListener("resize", moveHighlight);
    return () => window.removeEventListener("resize", moveHighlight);
  }, [moveHighlight]);

  // Enable the slide only after first paint, so load doesn't animate.
  useEffect(() => {
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setReady(true));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, []);

  const setActive = useCallback((index: number) => {
    if (index < 0 || index >= variants.length) {
      return;
    }
    setCurrent(index);
    setMountKey((key) => key + 1);
    const url = new URL(window.location.href);
    url.searchParams.set("v", String(index + 1));
    window.history.replaceState(null, "", url);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        isTypingTarget(event.target) ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      ) {
        return;
      }
      if (event.key === "r" || event.key === "R") {
        setMountKey((key) => key + 1);
        return;
      }
      const next = targetIndex(event.key, current);
      if (next !== null) {
        setActive(next);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [current, setActive]);

  const Variant = variants[current]?.Component ?? ClassicShell;

  return (
    <>
      <TooltipProvider delay={400}>
        <div className="h-svh overflow-hidden bg-background text-foreground">
          <Variant key={`${current}-${mountKey}`} />
        </div>
      </TooltipProvider>
      <nav
        aria-label="Prototype variants"
        className="proto-picker"
        data-ready={ready ? "" : undefined}
        ref={pickerRef}
      >
        <span
          aria-hidden="true"
          className="proto-picker-highlight"
          ref={highlightRef}
        />
        {variants.map((variant, index) => (
          <button
            aria-current={index === current ? "true" : undefined}
            className="proto-picker-item"
            data-active={index === current ? "" : undefined}
            key={variant.name}
            onClick={() => setActive(index)}
            ref={(el) => {
              itemRefs.current[index] = el;
            }}
            type="button"
          >
            {variant.name}
          </button>
        ))}
      </nav>
    </>
  );
};

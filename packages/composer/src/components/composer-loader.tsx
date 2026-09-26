"use client";

import {
  type ComponentType,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import type { ComposerHandoff, ComposerProps } from "../props";
import type { EditorComposerProps } from "./composer";
import { ComposerShell } from "./composer-shell";

export interface ComposerLoaderProps extends ComposerProps {
  /**
   * Fetches the editor module. A port so tests (and hosts with their own
   * loading policy) can decide when it arrives; defaults to a dynamic import,
   * which bundlers split into its own chunk.
   */
  readonly load?: () => Promise<{
    readonly Composer: ComponentType<EditorComposerProps>;
  }>;
}

type LoadState =
  | { readonly status: "loading" }
  | { readonly status: "failed" }
  | {
      readonly Editor: ComponentType<EditorComposerProps>;
      readonly status: "ready";
    };

const loadEditor = () => import("./composer");

const EMPTY_HANDOFF: ComposerHandoff = { caret: 0, focused: false, text: "" };

/**
 * Composer-first loading: paint ComposerShell at once (on the server too),
 * fetch the editor after hydration, then swap it in with whatever the user
 * already typed and their focus. The shell and editor share their layout, so
 * the swap doesn't shift anything.
 */
export function ComposerLoader({
  load = loadEditor,
  ...props
}: ComposerLoaderProps) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const handoff = useRef<ComposerHandoff>(EMPTY_HANDOFF);

  const recordHandoff = useCallback((next: ComposerHandoff) => {
    handoff.current = next;
  }, []);

  useEffect(() => {
    let current = true;
    load().then(
      (module) => {
        if (current) {
          setState({ Editor: module.Composer, status: "ready" });
        }
      },
      // A chunk that fails to load (a deploy mid-session, a flaky network)
      // leaves the shell up with a message rather than breaking the page.
      () => {
        if (current) {
          setState({ status: "failed" });
        }
      }
    );
    return () => {
      current = false;
    };
  }, [load]);

  if (state.status === "ready") {
    // Read once, when the editor mounts; later typing happens in the editor.
    return <state.Editor {...props} handoff={handoff.current} />;
  }
  return (
    <ComposerShell
      {...props}
      failed={state.status === "failed"}
      onHandoff={recordHandoff}
    />
  );
}

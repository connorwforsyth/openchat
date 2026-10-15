"use client";

import type { ArtifactId } from "@workspace/contract/schemas/common";
import { useEffect, useRef, useState } from "react";

import { historyModeFor, unseenArtifacts } from "../model/artifact-access";

/**
 * The address's `?artifact=` (171), when the host keeps one: `value` is what
 * it names now; `onChange` writes it, pushing a history entry or replacing
 * the current one.
 */
export interface ArtifactParam {
  readonly onChange: (
    artifactId: ArtifactId | null,
    mode: "push" | "replace"
  ) => void;
  readonly value: ArtifactId | null;
}

/**
 * Keeps the panel and the address in step. The address wins when it changes
 * (a reload, a shared link, Back and Forward); the panel wins when the
 * person picks or closes. Nothing happens before the stored layout is read,
 * which would otherwise close the panel the address just opened.
 */
export const useArtifactUrl = ({
  close,
  inView,
  open,
  param,
  restored,
}: {
  readonly close: () => void;
  /** What the panel shows now (`artifactInView`). */
  readonly inView: ArtifactId | null;
  readonly open: (artifactId: ArtifactId) => void;
  readonly param: ArtifactParam | undefined;
  readonly restored: boolean;
}): void => {
  const seenParam = useRef<ArtifactId | null>(null);
  const seenInView = useRef<ArtifactId | null>(inView);
  const latest = useRef({ close, open });
  useEffect(() => {
    latest.current = { close, open };
  });
  const value = param?.value ?? null;
  const onChange = param?.onChange;

  useEffect(() => {
    if (!(onChange && restored)) {
      return;
    }
    if (value !== seenParam.current) {
      const before = seenParam.current;
      seenParam.current = value;
      seenInView.current = value ?? inView;
      if (value !== null && value !== inView) {
        latest.current.open(value);
      } else if (value === null && before !== null && inView !== null) {
        // Back past the entry that opened it.
        seenInView.current = null;
        latest.current.close();
      }
      return;
    }
    if (inView !== seenInView.current) {
      const before = seenInView.current;
      seenInView.current = inView;
      if (inView !== value) {
        seenParam.current = inView;
        onChange(inView, historyModeFor(before, inView));
      }
    }
  }, [inView, onChange, restored, value]);
};

/**
 * Whether the chat has an artifact the person hasn't looked at: one that
 * arrived after the chat loaded, while the artifacts weren't showing. Looking
 * (`showing`) clears it; another chat starts with none.
 */
export const useFreshArtifacts = ({
  conversationKey,
  ids,
  loaded,
  showing,
}: {
  readonly conversationKey: string | null;
  readonly ids: readonly ArtifactId[];
  readonly loaded: boolean;
  readonly showing: boolean;
}): boolean => {
  const [state, setState] = useState<{
    readonly fresh: boolean;
    readonly key: string | null;
    readonly seen: ReadonlySet<ArtifactId> | null;
  }>({ fresh: false, key: conversationKey, seen: null });

  if (state.key !== conversationKey) {
    setState({ fresh: false, key: conversationKey, seen: null });
  } else if (state.seen === null) {
    if (loaded) {
      setState({ ...state, seen: new Set(ids) });
    }
  } else {
    const unseen = unseenArtifacts(state.seen, ids);
    if (unseen.length > 0) {
      setState({
        ...state,
        fresh: !showing,
        seen: new Set([...state.seen, ...unseen]),
      });
    } else if (state.fresh && showing) {
      setState({ ...state, fresh: false });
    }
  }
  return state.fresh;
};

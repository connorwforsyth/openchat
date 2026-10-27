"use client";

import type { AnnotationsData } from "@workspace/ai/messages/annotations";
import {
  createContext,
  type RefObject,
  useContext,
  useEffect,
  useEffectEvent,
} from "react";

import type { Locator } from "./locate";

// Where notes go, and how views say what's under a mark. The host that
// can send to the artifact's chat provides a sink; without one there's no
// Annotate (a viewer who can't write to the chat, a page with no chat).

export interface AnnotateSink {
  /**
   * `steer`: an answer is being written, and the notes steer it. `send`:
   * they start the next turn. `chat`: this page has no chat to send from,
   * so sending opens the chat, where the drafts are waiting.
   */
  readonly mode: "chat" | "send" | "steer";
  readonly send: (data: AnnotationsData) => Promise<void>;
}

const SinkContext = createContext<AnnotateSink | null>(null);

export const AnnotateSinkProvider = SinkContext.Provider;

export const useAnnotateSink = () => useContext(SinkContext);

/** Registers a view's locator for the element it draws into. */
export type RegisterLocator = (
  element: Element,
  locator: Locator
) => () => void;

const LocatorsContext = createContext<RegisterLocator | null>(null);

export const AnnotateLocatorsProvider = LocatorsContext.Provider;

/**
 * Says what's under a mark on `ref`'s element, for a view the DOM can't
 * describe (a canvas grid). A no-op outside an annotate layer.
 */
export const useAnnotateLocator = (
  ref: RefObject<Element | null>,
  locator: Locator
) => {
  const register = useContext(LocatorsContext);
  const latest = useEffectEvent(locator);
  useEffect(() => {
    const element = ref.current;
    return element && register
      ? register(element, (box) => latest(box))
      : undefined;
  }, [ref, register]);
};

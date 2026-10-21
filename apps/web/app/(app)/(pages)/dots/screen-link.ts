"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";

/** What the screen's page (`apps/sandbox-runner/desktop`) posts up. */
const screenMessageSchema = z.object({
  source: z.literal("dot-computer"),
  state: z.enum(["connected", "failed"]),
});

/**
 * Whether the screen gave up reconnecting to the desktop, and a way to start
 * it over: a new frame, so its page retries from the beginning. `ref` goes on
 * the frame; a new page loading in it hasn't given up yet.
 */
export const useScreenLink = () => {
  const frame = useRef<HTMLIFrameElement | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) {
        return;
      }
      const message = screenMessageSchema.safeParse(event.data);
      if (message.success) {
        setFailed(message.data.state === "failed");
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);
  const ref = useCallback((node: HTMLIFrameElement | null) => {
    frame.current = node;
    if (!node) {
      return;
    }
    const onLoad = () => setFailed(false);
    node.addEventListener("load", onLoad);
    return () => {
      node.removeEventListener("load", onLoad);
      frame.current = null;
    };
  }, []);
  const reconnect = useCallback(() => {
    setFailed(false);
    setAttempt((n) => n + 1);
  }, []);
  return { attempt, failed, reconnect, ref };
};

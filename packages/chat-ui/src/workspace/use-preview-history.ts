"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  type BrowserAction,
  type BrowserHistory,
  browserHistory,
  defaultPage,
  type PreviewRequest,
  type PreviewSources,
} from "./model/browser";

// The Preview's history while the panel is open. Until the person (or a
// request from the chat) goes somewhere, it follows the workspace's default
// page, so a server the agent starts replaces the static page it showed
// before. A request (`openPreview(path)`, an `.html` write) navigates once
// per id, as soon as there's something to show.

export const usePreviewHistory = (
  sources: PreviewSources,
  request: PreviewRequest | null | undefined
) => {
  const [own, setOwn] = useState<BrowserHistory | null>(null);
  const fallback = defaultPage(sources);
  const history: BrowserHistory | null =
    own ?? (fallback ? { entries: [fallback], index: 0, loads: 0 } : null);

  // The first action starts from what's on screen, which may be the default.
  const shown = useRef(history);
  useEffect(() => {
    shown.current = history;
  });
  const navigate = useCallback((action: BrowserAction) => {
    setOwn((current) => browserHistory(current ?? shown.current, action));
  }, []);

  const handled = useRef<number | null>(null);
  useEffect(() => {
    if (!request || handled.current === request.id) {
      return;
    }
    const page = request.page ?? defaultPage(sources);
    if (!page) {
      return;
    }
    handled.current = request.id;
    navigate({ page, type: "navigate" });
  }, [navigate, request, sources]);

  return { history, navigate };
};

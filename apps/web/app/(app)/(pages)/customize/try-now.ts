"use client";

import { textToDoc } from "@workspace/composer/doc";
import { draftDoc } from "@workspace/composer/drafts";
import {
  type Draft,
  type DraftStore,
  NEW_CHAT_DRAFT_KEY,
} from "@workspace/composer/ports/draft-store";
import {
  browserStorage,
  createStorageDraftStore,
} from "@workspace/composer/ports/draft-store.storage";
import type { PickedSkillOption } from "@workspace/composer/schemas";
import { useRouter } from "next/navigation";
import { useCallback, useMemo } from "react";

import { useAppFrame } from "@/app/(app)/_shared/app-frame";

// "Try now" (193), as ChatGPT's: a new chat with a starter prompt waiting in
// the composer, not sent, so nothing runs (or costs) until you send it. A
// skill rides along as a picked chip; a server is switched on for that chat
// by the address (`/?mcp=<id>`, saved with the first send).

/** The new chat's draft: the starter prompt, and the skill if there is one. */
export const tryNowDraft = (
  text: string,
  skill: PickedSkillOption | null
): Draft => ({
  doc: draftDoc(textToDoc(text)),
  skills: skill ? [skill] : [],
  templateId: null,
  version: 1,
});

/** Leaves the draft for the new chat, then opens it. */
export const startTryNow = (
  store: DraftStore,
  go: (href: string) => void,
  { href, skill = null, text }: TryNow
): void => {
  // Best effort: without storage the chat still opens, just empty.
  store.save(NEW_CHAT_DRAFT_KEY, tryNowDraft(text, skill));
  go(href);
};

export interface TryNow {
  readonly href: string;
  readonly skill?: PickedSkillOption | null;
  readonly text: string;
}

export const useTryNow = (): ((tryNow: TryNow) => void) => {
  const router = useRouter();
  const { me } = useAppFrame();
  const store = useMemo(
    () => createStorageDraftStore(browserStorage, me.user.id),
    [me.user.id]
  );
  return useCallback(
    (tryNow: TryNow) => startTryNow(store, router.push, tryNow),
    [router, store]
  );
};

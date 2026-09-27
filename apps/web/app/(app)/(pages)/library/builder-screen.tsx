"use client";

import type {
  LibraryItemId,
  LibraryVersionId,
} from "@workspace/contract/schemas/common";
import type { LibraryItemDetail } from "@workspace/contract/schemas/library";
import {
  type BuilderTarget,
  ItemBuilder,
  type ItemBuilderProps,
} from "@workspace/library-ui/components/item-builder";
import { createRunTestChat } from "@workspace/library-ui/components/run-test-chat";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";

import { routes } from "@/lib/routes";

import { NextLink } from "./next-link";
import { useApiClient } from "./providers";

// Pins (D13) have no server field yet, so they're a per-browser choice kept
// in localStorage; storage can be missing or refuse, and then pins just
// don't stick.
const PINS_KEY = "library.pins";

const readPins = (): Record<string, LibraryVersionId> => {
  try {
    return JSON.parse(localStorage.getItem(PINS_KEY) ?? "{}") as Record<
      string,
      LibraryVersionId
    >;
  } catch {
    return {};
  }
};

const usePins = (): NonNullable<ItemBuilderProps["pins"]> => {
  const [pins, setPins] = useState<Record<string, LibraryVersionId>>(readPins);
  return useMemo(
    () => ({
      get: (id: LibraryItemId) => pins[id] ?? null,
      set: (id: LibraryItemId, versionId: LibraryVersionId | null) => {
        const next = { ...pins };
        if (versionId) {
          next[id] = versionId;
        } else {
          delete next[id];
        }
        setPins(next);
        try {
          localStorage.setItem(PINS_KEY, JSON.stringify(next));
        } catch {
          // Private windows and blocked storage: the pin lasts this visit.
        }
      },
    }),
    [pins]
  );
};

export function BuilderScreen({ target }: { readonly target: BuilderTarget }) {
  const router = useRouter();
  const api = useApiClient();
  const testChat = useMemo(() => createRunTestChat(api), [api]);
  const pins = usePins();
  const open = useCallback(
    (item: LibraryItemDetail) => router.replace(routes.libraryItem(item.id)),
    [router]
  );
  const openCopy = useCallback(
    (item: LibraryItemDetail) => router.push(routes.libraryItem(item.id)),
    [router]
  );
  const back = useCallback(() => router.push(routes.library), [router]);
  return (
    <ItemBuilder
      backHref={routes.library}
      link={NextLink}
      onCreated={open}
      onDeleted={back}
      onDuplicated={openCopy}
      pins={pins}
      target={target}
      testChat={testChat}
    />
  );
}

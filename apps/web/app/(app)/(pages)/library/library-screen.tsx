"use client";

import type {
  LibraryItem,
  LibraryKind,
} from "@workspace/contract/schemas/library";
import { LibraryIndex } from "@workspace/library-ui/components/library-index";
import { useRouter } from "next/navigation";
import { useCallback } from "react";

import { routes } from "@/lib/routes";

import { NextLink } from "./next-link";

const itemHref = (item: LibraryItem) => routes.libraryItem(item.id);
const newHref = (kind: LibraryKind) => routes.libraryNew(kind);
const chatHref = (item: LibraryItem) => routes.chatWithAgent(item.id);

export function LibraryScreen() {
  const router = useRouter();
  const opened = useCallback(
    (item: LibraryItem) => router.push(itemHref(item)),
    [router]
  );
  return (
    <LibraryIndex
      chatHref={chatHref}
      itemHref={itemHref}
      link={NextLink}
      newHref={newHref}
      onImported={opened}
    />
  );
}

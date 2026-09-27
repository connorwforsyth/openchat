"use client";

import type {
  LibraryItem,
  LibraryKind,
} from "@workspace/contract/schemas/library";
import { LibraryIndex } from "@workspace/library-ui/components/library-index";
import { useRouter } from "next/navigation";
import { useCallback } from "react";

import { NextLink } from "./next-link";

const itemHref = (item: LibraryItem) => `/library/${item.id}`;
const newHref = (kind: LibraryKind) => `/library/new/${kind}`;

export function LibraryScreen() {
  const router = useRouter();
  const opened = useCallback(
    (item: LibraryItem) => router.push(itemHref(item)),
    [router]
  );
  return (
    <LibraryIndex
      itemHref={itemHref}
      link={NextLink}
      newHref={newHref}
      onImported={opened}
    />
  );
}

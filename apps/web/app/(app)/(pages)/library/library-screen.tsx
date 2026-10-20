"use client";

import {
  type LibraryItem,
  type LibraryKind,
  libraryKindSchema,
  libraryTabSchema,
} from "@workspace/contract/schemas/library";
import { LibraryIndex } from "@workspace/library-ui/components/library-index";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

import { routeParams, routes } from "@/lib/routes";

import { NextLink } from "./next-link";

const itemHref = (item: LibraryItem) => routes.libraryItem(item.id);
const newHref = (kind: LibraryKind) => routes.libraryNew(kind);
const chatHref = (item: LibraryItem) => routes.chatWithAgent(item.id);

export function LibraryScreen() {
  const router = useRouter();
  // The rail panel's sections link here with `?kind=` or `?tab=` (181).
  const params = useSearchParams();
  const kind = libraryKindSchema
    .optional()
    .catch(undefined)
    .parse(params.get(routeParams.kind) ?? undefined);
  const tab = libraryTabSchema
    .optional()
    .catch(undefined)
    .parse(params.get(routeParams.tab) ?? undefined);
  const opened = useCallback(
    (item: LibraryItem) => router.push(itemHref(item)),
    [router]
  );
  return (
    <LibraryIndex
      chatHref={chatHref}
      itemHref={itemHref}
      kind={kind}
      link={NextLink}
      newHref={newHref}
      onImported={opened}
      tab={tab}
    />
  );
}

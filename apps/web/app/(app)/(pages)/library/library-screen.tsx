"use client";

import {
  type LibraryItem,
  type LibraryKind,
  libraryKindSchema,
  libraryTabSchema,
} from "@workspace/contract/schemas/library";
import {
  type LibraryFilter,
  LibraryIndex,
} from "@workspace/library-ui/components/library-index";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

import { useRailPanels } from "@/app/(app)/(pages)/page-shell";
import { routeParams, routes } from "@/lib/routes";

import { NextLink } from "./next-link";

const itemHref = (item: LibraryItem) => routes.libraryItem(item.id);
const newHref = (kind: LibraryKind) => routes.libraryNew(kind);
const chatHref = (item: LibraryItem) => routes.chatWithAgent(item.id);

const filterHref = ({ kind, tab }: LibraryFilter) => {
  const query = new URLSearchParams();
  if (tab !== "mine") {
    query.set(routeParams.tab, tab);
  }
  if (kind) {
    query.set(routeParams.kind, kind);
  }
  return query.size > 0 ? `${routes.library}?${query}` : routes.library;
};

export function LibraryScreen() {
  const router = useRouter();
  // The rail panel's sections link here with `?kind=` or `?tab=` (181);
  // without the panel, the index's own filters set them.
  const params = useSearchParams();
  const railPanels = useRailPanels();
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
  const filtered = useCallback(
    (filter: LibraryFilter) => router.push(filterHref(filter)),
    [router]
  );
  return (
    <LibraryIndex
      chatHref={chatHref}
      itemHref={itemHref}
      // A new address starts the search afresh.
      key={params.toString()}
      kind={kind}
      link={NextLink}
      newHref={newHref}
      onFilterChange={railPanels ? undefined : filtered}
      onImported={opened}
      tab={tab}
    />
  );
}

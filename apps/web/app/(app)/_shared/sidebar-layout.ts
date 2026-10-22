"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DEFAULT_SIDEBAR_LAYOUT,
  useStoredSidebarLayout,
} from "@workspace/chat-ui/shell/sidebar-layout";
import {
  type SidebarLayoutSetting,
  sidebarLayoutSchema,
  type UserSettings,
} from "@workspace/contract/schemas/meta";
import { useCallback, useEffect, useRef } from "react";

import { useApi } from "./api";

/**
 * The user's sidebar layout (181), kept in their settings so it follows them
 * across devices. This browser keeps a copy, which answers while settings
 * load, offline, or when the server has none yet; the account's choice wins
 * once it's known.
 */
export const useSidebarLayoutSetting = (
  userId: string
): readonly [SidebarLayoutSetting, (next: SidebarLayoutSetting) => void] => {
  const { query } = useApi();
  const queryClient = useQueryClient();
  const settings = useQuery(query.me.settings.queryOptions());
  const storageKey = `sidebar-layout:${userId}`;
  const [stored, setStored] = useStoredSidebarLayout(storageKey);
  const { mutate } = useMutation(
    query.me.updateSettings.mutationOptions({
      onError: () =>
        queryClient.invalidateQueries({
          queryKey: query.me.settings.queryKey(),
        }),
      onSuccess: (next) =>
        queryClient.setQueryData(query.me.settings.queryKey(), next),
      // Two quick switches save in order, so the last one wins.
      scope: { id: "sidebar-layout" },
    })
  );
  const saved = settings.data?.sidebarLayout;
  // Settings restored from an earlier visit may predate the account's choice;
  // only what arrived during this page says whether it has one.
  const fresh =
    settings.isSuccess && settings.dataUpdatedAt >= performance.timeOrigin;
  // What this tab last put in storage, or saw another tab put there.
  const inStorage = useRef<SidebarLayoutSetting | undefined>(undefined);

  useEffect(() => {
    if (saved !== undefined && saved !== inStorage.current) {
      inStorage.current = saved;
      setStored(saved);
    }
  }, [saved, setStored]);

  useEffect(() => {
    if (fresh && saved === undefined && stored !== DEFAULT_SIDEBAR_LAYOUT) {
      // Chosen in this browser before the account kept the choice.
      mutate({ sidebarLayout: stored });
    }
  }, [fresh, mutate, saved, stored]);

  // Shows `next` now, already in storage. An older settings response still in
  // flight would land over it, so that's cancelled.
  const show = useCallback(
    (next: SidebarLayoutSetting) => {
      inStorage.current = next;
      const queryKey = query.me.settings.queryKey();
      queryClient.cancelQueries({ queryKey });
      queryClient.setQueryData<UserSettings>(queryKey, (old) =>
        old ? { ...old, sidebarLayout: next } : old
      );
    },
    [query, queryClient]
  );

  // Another tab switched and saved it; follow instead of writing ours back.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      const next = sidebarLayoutSchema.safeParse(event.newValue);
      if (event.key === storageKey && next.success) {
        show(next.data);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [show, storageKey]);

  const setLayout = useCallback(
    (next: SidebarLayoutSetting) => {
      setStored(next);
      show(next);
      mutate({ sidebarLayout: next });
    },
    [mutate, setStored, show]
  );

  return [saved ?? stored, setLayout];
};

"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DEFAULT_SIDEBAR_LAYOUT,
  useStoredSidebarLayout,
} from "@workspace/chat-ui/shell/sidebar-layout";
import type {
  SidebarLayoutSetting,
  UserSettings,
} from "@workspace/contract/schemas/meta";
import { useCallback, useEffect } from "react";

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
  const [stored, setStored] = useStoredSidebarLayout(
    `sidebar-layout:${userId}`
  );
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
  const loaded = settings.data !== undefined;

  useEffect(() => {
    if (!loaded) {
      return;
    }
    if (saved !== undefined) {
      if (saved !== stored) {
        setStored(saved);
      }
    } else if (stored !== DEFAULT_SIDEBAR_LAYOUT) {
      // Chosen in this browser before the account kept the choice.
      mutate({ sidebarLayout: stored });
    }
  }, [loaded, mutate, saved, setStored, stored]);

  const setLayout = useCallback(
    (next: SidebarLayoutSetting) => {
      setStored(next);
      queryClient.setQueryData<UserSettings>(
        query.me.settings.queryKey(),
        (old) => (old ? { ...old, sidebarLayout: next } : old)
      );
      mutate({ sidebarLayout: next });
    },
    [mutate, query, queryClient, setStored]
  );

  return [saved ?? stored, setLayout];
};

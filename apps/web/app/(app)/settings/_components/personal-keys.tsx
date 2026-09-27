"use client";

import { useQuery } from "@tanstack/react-query";

import { useApi } from "../../_shared/api";
import { KeysManager } from "../../_shared/keys-manager";
import { QueryState } from "../../_shared/query-state";

/** Keys that pay for the caller's Personal chats (D17). */
export const PersonalKeys = () => {
  const { query } = useApi();
  const me = useQuery(query.me.get.queryOptions());
  return (
    <QueryState query={me}>
      {(data) => <KeysManager owner={{ id: data.user.id, type: "user" }} />}
    </QueryState>
  );
};

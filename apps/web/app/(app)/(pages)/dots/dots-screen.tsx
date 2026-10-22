"use client";

import { useQuery } from "@tanstack/react-query";
import type { Dot } from "@workspace/contract/schemas/dots";
import { Spinner } from "@workspace/ui/components/spinner";
import { useRouter } from "next/navigation";
import { useCallback, useEffect } from "react";

import { useApi } from "@/app/(app)/_shared/api";
import { QueryState } from "@/app/(app)/_shared/query-state";
import { routes } from "@/lib/routes";

import { DotOnboarding } from "./onboarding";

// `/dots` (174): you have one Dot, and it is a thread. With it made, this
// page only forwards to its chat; before that, it's the short onboarding,
// which ends in that chat too.

export function DotsScreen() {
  const router = useRouter();
  const { query } = useApi();
  const dots = useQuery(query.dots.list.queryOptions({ input: {} }));
  const mine = dots.data?.[0] ?? null;
  useEffect(() => {
    if (mine) {
      router.replace(routes.chat(mine.conversationId));
    }
  }, [mine, router]);
  const created = useCallback(
    (dot: Dot) => router.push(routes.chat(dot.conversationId)),
    [router]
  );

  return (
    <QueryState query={dots}>
      {(list) =>
        list.length === 0 ? (
          <DotOnboarding existing={0} onCreated={created} />
        ) : (
          <div className="flex flex-1 items-center justify-center py-16">
            <Spinner />
          </div>
        )
      }
    </QueryState>
  );
}

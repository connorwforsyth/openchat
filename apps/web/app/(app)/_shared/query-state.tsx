"use client";

import { Trans } from "@lingui/react/macro";
import type { UseQueryResult } from "@tanstack/react-query";
import { CircleAlertIcon } from "@workspace/icons";
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@workspace/ui/components/alert";
import { Button } from "@workspace/ui/components/button";
import { Skeleton } from "@workspace/ui/components/skeleton";
import type { ReactNode } from "react";

// Loading and failure for one query, the same way on every page: a skeleton
// while it loads, an alert with a retry when it fails. Pages render their
// content only with data in hand.

const errorCode = (error: unknown): string | null =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  typeof error.code === "string"
    ? error.code
    : null;

/** The oRPC error code (`FORBIDDEN`, `CONFLICT`, …) of a failed call, if any. */
export const codeOf = errorCode;

export const LoadError = ({
  error,
  onRetry,
}: {
  readonly error: unknown;
  readonly onRetry?: () => void;
}) => {
  const code = errorCode(error);
  return (
    <Alert variant="destructive">
      <CircleAlertIcon />
      <AlertTitle>
        {code === "FORBIDDEN" ? (
          <Trans>You don't have access to this.</Trans>
        ) : (
          <Trans>This couldn't be loaded.</Trans>
        )}
      </AlertTitle>
      <AlertDescription>
        {code === "FEATURE_DISABLED" ? (
          <Trans>This feature is switched off on this server.</Trans>
        ) : (
          <Trans>Check your connection and try again.</Trans>
        )}
      </AlertDescription>
      {onRetry && code !== "FORBIDDEN" ? (
        <AlertAction>
          <Button onClick={onRetry} size="sm" variant="outline">
            <Trans>Try again</Trans>
          </Button>
        </AlertAction>
      ) : null}
    </Alert>
  );
};

const SKELETON_ROWS = ["a", "b", "c", "d", "e", "f"] as const;

export const QueryState = <T,>({
  children,
  query,
  skeleton = 3,
}: {
  readonly children: (data: T) => ReactNode;
  readonly query: UseQueryResult<T>;
  /** Rows of skeleton while loading. */
  readonly skeleton?: number;
}) => {
  if (query.isPending) {
    return (
      <div aria-busy="true" className="flex flex-col gap-2">
        {SKELETON_ROWS.slice(0, skeleton).map((row) => (
          <Skeleton className="h-9 w-full" key={row} />
        ))}
      </div>
    );
  }
  if (query.isError) {
    return <LoadError error={query.error} onRetry={query.refetch} />;
  }
  return <>{children(query.data)}</>;
};

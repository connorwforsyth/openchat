"use client";

import { useQuery } from "@tanstack/react-query";
import type { QueryUtils } from "@workspace/client/api";
import type { ArtifactKind } from "@workspace/contract/schemas/message-parts";

import { artifactKinds } from "../model/artifact-kinds";

const NONE: readonly ArtifactKind[] = [];

/**
 * The kinds this instance offers (`artifacts.kinds.enabled`), for what
 * people can start or filter by. None until the config has loaded, so a
 * turned-off kind never flashes up; every kind from an older server.
 */
export const useOfferedKinds = (api: QueryUtils): readonly ArtifactKind[] => {
  const { data } = useQuery(api.meta.config.queryOptions());
  if (!data) {
    return NONE;
  }
  return data.artifacts.kinds ?? artifactKinds;
};

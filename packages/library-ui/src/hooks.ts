"use client";

import {
  type QueryClient,
  type QueryKey,
  skipToken,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  LibraryItemId,
  LibraryVersionId,
  UserId,
} from "@workspace/contract/schemas/common";
import type {
  CreateGrantInput,
  ResourceGrant,
  ResourceRef,
} from "@workspace/contract/schemas/grants";
import type {
  LibraryDefinitionInput,
  LibraryExport,
  LibraryItem,
  LibraryItemDetail,
  LibraryPermission,
  LibraryVersion,
} from "@workspace/contract/schemas/library";
import type { Principal } from "@workspace/contract/schemas/tenancy";
import { useCallback } from "react";

import {
  applyItemUpdate,
  type ItemPage,
  type ListData,
  type ListFilter,
  libraryKeys,
  patchListItem,
  pendingCopy,
  pendingGrant,
  prependListItem,
  removeListItem,
  replaceListItem,
  setGrantLevel,
  type UpdateVariables,
  upsertGrant,
  withoutGrant,
} from "./cache";
import { useLibraryClient } from "./client";

// TanStack Query over the library slice of the API. Edits, sharing and
// publishing are optimistic (D28): `onMutate` edits the cache, `onError`
// puts back exactly what it replaced, and `onSettled` revalidates.

const PAGE_SIZE = 50;

type Snapshot = readonly (readonly [QueryKey, unknown])[];

/** Applies `update` to every cached query under `key`, returning what was there. */
const edit = async <T>(
  queryClient: QueryClient,
  key: QueryKey,
  update: (old: T | undefined) => T | undefined
): Promise<Snapshot> => {
  await queryClient.cancelQueries({ queryKey: key });
  const before = queryClient.getQueriesData<T>({ queryKey: key });
  queryClient.setQueriesData<T>({ queryKey: key }, update);
  return before;
};

const restore = (queryClient: QueryClient, snapshots: readonly Snapshot[]) => {
  for (const snapshot of snapshots) {
    for (const [key, data] of snapshot) {
      queryClient.setQueryData(key, data);
    }
  }
};

export interface OptimisticContext {
  readonly snapshots: readonly Snapshot[];
}

// --- Reads ---

export const useLibraryList = (filter: ListFilter) => {
  const client = useLibraryClient();
  return useInfiniteQuery({
    getNextPageParam: (page: ItemPage) => page.nextCursor ?? undefined,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const page = await client.library.list({
        cursor: pageParam,
        kind: filter.kind,
        limit: PAGE_SIZE,
        query: filter.query || undefined,
        tab: filter.tab,
      });
      return { items: [...page.items], nextCursor: page.nextCursor };
    },
    queryKey: libraryKeys.list(filter),
  });
};

/** An item's editable draft if the caller may edit it, else what they may see. */
export const useLibraryItem = (
  id: LibraryItemId,
  revision: "draft" | "latest" = "draft"
) => {
  const client = useLibraryClient();
  return useQuery({
    queryFn: async () => {
      try {
        return await client.library.get({ id, revision });
      } catch (error) {
        // Asking for the draft without `edit` is refused; fall back to what they can see.
        if (revision === "draft" && isCode(error, "FORBIDDEN")) {
          return await client.library.get({ id, revision: "latest" });
        }
        throw error;
      }
    },
    queryKey: libraryKeys.detail(id, revision),
  });
};

/** Reads an item on demand (a prompt's template for a `/` menu), through the cache. */
export const useFetchItem = () => {
  const client = useLibraryClient();
  const queryClient = useQueryClient();
  return useCallback(
    (id: LibraryItemId, revision: "draft" | "latest") =>
      queryClient.fetchQuery({
        queryFn: () => client.library.get({ id, revision }),
        queryKey: libraryKeys.detail(id, revision),
      }),
    [client, queryClient]
  );
};

export const useVersions = (id: LibraryItemId, enabled = true) => {
  const client = useLibraryClient();
  return useQuery({
    enabled,
    queryFn: async () =>
      (await client.library.listVersions({ id, limit: 100 })).items,
    queryKey: libraryKeys.versions(id),
  });
};

export const useVersion = (
  id: LibraryItemId,
  versionId: LibraryVersionId | null
) => {
  const client = useLibraryClient();
  return useQuery({
    enabled: versionId !== null,
    queryFn: () =>
      client.library.getVersion({
        id,
        versionId: versionId as LibraryVersionId,
      }),
    queryKey: [...libraryKeys.versions(id), versionId],
  });
};

export const useMe = () => {
  const client = useLibraryClient();
  return useQuery({ queryFn: () => client.me.get(), queryKey: libraryKeys.me });
};

export const usePublicConfig = () => {
  const client = useLibraryClient();
  return useQuery({
    queryFn: () => client.meta.config(),
    queryKey: libraryKeys.config,
  });
};

export const useModels = () => {
  const client = useLibraryClient();
  return useQuery({
    queryFn: () => client.meta.models({ contextType: "personal" }),
    queryKey: libraryKeys.models,
  });
};

export const useOrgMembers = (orgIds: readonly string[]) => {
  const client = useLibraryClient();
  return useQuery({
    enabled: orgIds.length > 0,
    queryFn: async () => {
      const pages = await Promise.all(
        orgIds.map((orgId) =>
          client.orgs.members({ limit: 100, orgId } as never)
        )
      );
      const seen = new Map<string, (typeof pages)[number]["items"][number]>();
      for (const page of pages) {
        for (const member of page.items) {
          seen.set(member.user.id, member);
        }
      }
      return [...seen.values()].map((member) => member.user);
    },
    queryKey: ["orgs", orgIds, "members"],
  });
};

export const useGrants = (ref: ResourceRef | null) => {
  const client = useLibraryClient();
  return useQuery({
    enabled: ref !== null,
    queryFn: () => client.grants.list(ref as ResourceRef),
    queryKey: libraryKeys.grants(ref?.resourceId ?? ""),
  });
};

export const useShareLinks = (ref: ResourceRef | null, enabled: boolean) => {
  const client = useLibraryClient();
  return useQuery({
    enabled: enabled && ref !== null,
    queryFn: () => client.shareLinks.list(ref as ResourceRef),
    queryKey: libraryKeys.links(ref?.resourceId ?? ""),
  });
};

export const useMcpStatus = (id: LibraryItemId | null) => {
  const client = useLibraryClient();
  return useQuery({
    enabled: id !== null,
    queryFn: () => client.mcp.status({ id: id as LibraryItemId }),
    queryKey: libraryKeys.mcpStatus(id ?? ""),
    retry: false,
  });
};

// --- Writes ---

export const useCreateItem = () => {
  const client = useLibraryClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      readonly definition: LibraryDefinitionInput;
      readonly description?: string;
      readonly name: string;
    }) =>
      client.library.create({
        definition: input.definition,
        description: input.description ?? "",
        icon: null,
        name: input.name,
      }),
    onSuccess: (created) => {
      queryClient.setQueryData(
        libraryKeys.detail(created.id, "draft"),
        created
      );
      return queryClient.invalidateQueries({ queryKey: libraryKeys.lists });
    },
  });
};

/** Saves the draft (or an unversioned item) optimistically. */
export const useUpdateItem = (id: LibraryItemId) => {
  const client = useLibraryClient();
  const queryClient = useQueryClient();
  return useMutation<
    LibraryItemDetail,
    Error,
    UpdateVariables,
    OptimisticContext
  >({
    mutationFn: (update) => client.library.update({ id, ...update }),
    onError: (_error, _update, context) =>
      restore(queryClient, context?.snapshots ?? []),
    onMutate: async (update) => ({
      snapshots: [
        await edit<LibraryItemDetail>(
          queryClient,
          libraryKeys.detail(id, "draft"),
          (old) => applyItemUpdate(old, update)
        ),
        await edit<ListData>(queryClient, libraryKeys.lists, (old) =>
          patchListItem(old, id, {
            ...(update.name === undefined ? {} : { name: update.name }),
            ...(update.description === undefined
              ? {}
              : { description: update.description }),
          })
        ),
      ],
    }),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: libraryKeys.lists }),
    onSuccess: (saved) => {
      queryClient.setQueryData(libraryKeys.detail(id, "draft"), saved);
    },
  });
};

export const useDeleteItem = () => {
  const client = useLibraryClient();
  const queryClient = useQueryClient();
  return useMutation<void, Error, LibraryItemId, OptimisticContext>({
    mutationFn: (id) => client.library.delete({ id }),
    onError: (_error, _id, context) =>
      restore(queryClient, context?.snapshots ?? []),
    onMutate: async (id) => ({
      snapshots: [
        await edit<ListData>(queryClient, libraryKeys.lists, (old) =>
          removeListItem(old, id)
        ),
      ],
    }),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: libraryKeys.lists }),
  });
};

export interface DuplicateNotice {
  /** Knowledge files the server left out: ones the caller can't read on their own. */
  readonly omittedKnowledgeFiles: number;
}

/**
 * How many of the original's knowledge files the copy doesn't have. The
 * server drops the ones the caller could only search through the original,
 * and the response has no field for that, so compare with the original
 * (duplicating needs `view`, which sees its definition). Best effort: if
 * the original can't be read now, say nothing rather than fail the copy.
 */
const omittedKnowledge = async (
  client: ReturnType<typeof useLibraryClient>,
  sourceId: LibraryItemId,
  copy: LibraryItemDetail
): Promise<number> => {
  if (copy.definition?.kind !== "agent") {
    return 0;
  }
  try {
    const source = await client.library.get({
      id: sourceId,
      revision: "latest",
    });
    if (source.definition?.kind !== "agent") {
      return 0;
    }
    const kept = new Set<string>(copy.definition.knowledgeFileIds);
    return source.definition.knowledgeFileIds.filter((id) => !kept.has(id))
      .length;
  } catch {
    return 0;
  }
};

export const useDuplicateItem = () => {
  const client = useLibraryClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      readonly id: LibraryItemId;
      readonly name?: string;
    }) => client.library.duplicate(input),
    onSuccess: async (copy, input) => {
      queryClient.setQueryData(libraryKeys.detail(copy.id, "draft"), copy);
      const omitted = await omittedKnowledge(client, input.id, copy);
      if (omitted > 0) {
        queryClient.setQueryData<DuplicateNotice>(
          libraryKeys.duplicateNotice(copy.id),
          { omittedKnowledgeFiles: omitted }
        );
      }
      await edit<ListData>(
        queryClient,
        libraryKeys.list({ tab: "mine" }),
        (old) => prependListItem(old, copy)
      );
      return queryClient.invalidateQueries({ queryKey: libraryKeys.lists });
    },
  });
};

/** The notice a fresh copy carries (see `useDuplicateItem`), and dismissing it. */
export const useDuplicateNotice = (id: LibraryItemId) => {
  const queryClient = useQueryClient();
  const notice = useQuery<DuplicateNotice | null>({
    queryFn: skipToken,
    queryKey: libraryKeys.duplicateNotice(id),
  });
  // Cleared rather than removed: removing wouldn't tell this observer.
  const dismiss = useCallback(
    () =>
      queryClient.setQueryData<DuplicateNotice | null>(
        libraryKeys.duplicateNotice(id),
        null
      ),
    [id, queryClient]
  );
  return { dismiss, notice: notice.data ?? null };
};

export const useImportItem = () => {
  const client = useLibraryClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (document: Parameters<LibraryClientImport>[0]["document"]) =>
      client.library.import({ document }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: libraryKeys.lists }),
  });
};

type LibraryClientImport = ReturnType<
  typeof useLibraryClient
>["library"]["import"];

export const useExportItem = () => {
  const client = useLibraryClient();
  return useMutation<LibraryExport, Error, LibraryItemId>({
    mutationFn: (id) => client.library.export({ id }),
  });
};

/**
 * Publishes the draft as the next version. Optimistic: the item shows the
 * next number at once.
 */
export const usePublishVersion = (id: LibraryItemId) => {
  const client = useLibraryClient();
  const queryClient = useQueryClient();
  return useMutation<
    LibraryVersion,
    Error,
    { readonly notes?: string },
    OptimisticContext
  >({
    mutationFn: ({ notes }) =>
      client.library.publishVersion({ id, notes: notes || undefined }),
    onError: (_error, _vars, context) =>
      restore(queryClient, context?.snapshots ?? []),
    onMutate: async () => {
      const bump = (n: number | null) => (n ?? 0) + 1;
      return {
        snapshots: [
          await edit<LibraryItemDetail>(
            queryClient,
            libraryKeys.item(id),
            (old) =>
              old && "definition" in old
                ? { ...old, latestVersionNumber: bump(old.latestVersionNumber) }
                : old
          ),
          await edit<ListData>(queryClient, libraryKeys.lists, (old) =>
            mapItem(old, id, (item) => ({
              latestVersionNumber: bump(item.latestVersionNumber),
            }))
          ),
        ],
      };
    },
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: libraryKeys.item(id) }),
        queryClient.invalidateQueries({ queryKey: libraryKeys.lists }),
      ]),
  });
};

const mapItem = (
  data: ListData | undefined,
  id: string,
  patch: (item: LibraryItem) => Partial<LibraryItem>
): ListData | undefined => {
  const item = data?.pages
    .flatMap((page) => page.items)
    .find((each) => each.id === id);
  return item ? patchListItem(data, id, patch(item)) : data;
};

/**
 * Publish to a team or org library. Optimistic: a placeholder copy joins
 * the Spaces tab at once and becomes the real one when the server answers.
 */
export const usePublishToLibrary = (
  source: LibraryItem,
  userId: UserId | null
) => {
  const client = useLibraryClient();
  const queryClient = useQueryClient();
  return useMutation<
    LibraryItemDetail,
    Error,
    { readonly target: Principal & { readonly type: "team" | "org" } },
    OptimisticContext & { readonly placeholderId: string }
  >({
    mutationFn: ({ target }) =>
      client.library.publishToLibrary({ id: source.id, target }),
    onError: (_error, _vars, context) =>
      restore(queryClient, context?.snapshots ?? []),
    onMutate: async ({ target }) => {
      const placeholder = pendingCopy(
        source,
        target,
        userId ?? source.createdBy
      );
      return {
        placeholderId: placeholder.id,
        snapshots: [
          await edit<ListData>(
            queryClient,
            libraryKeys.list({ tab: "libraries" }),
            (old) => prependListItem(old, placeholder)
          ),
        ],
      };
    },
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: libraryKeys.lists }),
    onSuccess: (copy, _vars, context) => {
      queryClient.setQueriesData<ListData>(
        { queryKey: libraryKeys.list({ tab: "libraries" }) },
        (old) => replaceListItem(old, context.placeholderId, copy)
      );
    },
  });
};

export const useRestoreVersion = (id: LibraryItemId) => {
  const client = useLibraryClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (versionId: LibraryVersionId) =>
      client.library.restoreVersion({ id, versionId }),
    onSuccess: (restored) => {
      queryClient.setQueryData(libraryKeys.detail(id, "draft"), restored);
      return queryClient.invalidateQueries({
        queryKey: libraryKeys.versions(id),
      });
    },
  });
};

// --- Sharing (grants) and public links ---

/** Share with a person, team or org. Optimistic: the row appears at once. */
export const useShare = (ref: ResourceRef, userId: UserId | null) => {
  const client = useLibraryClient();
  const queryClient = useQueryClient();
  const key = libraryKeys.grants(ref.resourceId);
  return useMutation<
    ResourceGrant,
    Error,
    { readonly permission: LibraryPermission; readonly principal: Principal },
    OptimisticContext
  >({
    mutationFn: ({ permission, principal }) =>
      client.grants.create({
        ...ref,
        permission,
        principal,
      } as CreateGrantInput),
    onError: (_error, _vars, context) =>
      restore(queryClient, context?.snapshots ?? []),
    onMutate: async ({ permission, principal }) => ({
      snapshots: [
        await edit<ResourceGrant[]>(queryClient, key, (old) =>
          upsertGrant(
            old,
            pendingGrant(
              { ...ref, permission, principal } as CreateGrantInput,
              userId ?? ("" as UserId)
            )
          )
        ),
      ],
    }),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: key }),
        queryClient.invalidateQueries({ queryKey: libraryKeys.lists }),
      ]),
  });
};

export const useUpdateGrant = (ref: ResourceRef) => {
  const client = useLibraryClient();
  const queryClient = useQueryClient();
  const key = libraryKeys.grants(ref.resourceId);
  return useMutation<
    ResourceGrant,
    Error,
    {
      readonly id: ResourceGrant["id"];
      readonly permission: LibraryPermission;
    },
    OptimisticContext
  >({
    mutationFn: (input) => client.grants.update(input),
    onError: (_error, _vars, context) =>
      restore(queryClient, context?.snapshots ?? []),
    onMutate: async ({ id, permission }) => ({
      snapshots: [
        await edit<ResourceGrant[]>(queryClient, key, (old) =>
          setGrantLevel(old, id, permission)
        ),
      ],
    }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });
};

export const useRevokeGrant = (ref: ResourceRef) => {
  const client = useLibraryClient();
  const queryClient = useQueryClient();
  const key = libraryKeys.grants(ref.resourceId);
  return useMutation<void, Error, ResourceGrant["id"], OptimisticContext>({
    mutationFn: (id) => client.grants.revoke({ id }),
    onError: (_error, _vars, context) =>
      restore(queryClient, context?.snapshots ?? []),
    onMutate: async (id) => ({
      snapshots: [
        await edit<ResourceGrant[]>(queryClient, key, (old) =>
          withoutGrant(old, id)
        ),
      ],
    }),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: key }),
        queryClient.invalidateQueries({ queryKey: libraryKeys.lists }),
      ]),
  });
};

export const useCreateShareLink = (ref: ResourceRef) => {
  const client = useLibraryClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => client.shareLinks.create(ref),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({
          queryKey: libraryKeys.links(ref.resourceId),
        }),
        queryClient.invalidateQueries({ queryKey: libraryKeys.lists }),
      ]),
  });
};

export const useRevokeShareLink = (ref: ResourceRef) => {
  const client = useLibraryClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: Parameters<LibraryClientRevokeLink>[0]["id"]) =>
      client.shareLinks.revoke({ id }),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({
          queryKey: libraryKeys.links(ref.resourceId),
        }),
        queryClient.invalidateQueries({ queryKey: libraryKeys.lists }),
      ]),
  });
};

type LibraryClientRevokeLink = ReturnType<
  typeof useLibraryClient
>["shareLinks"]["revoke"];

// --- MCP connection ---

export const useStartOAuth = (id: LibraryItemId) => {
  const client = useLibraryClient();
  return useMutation({ mutationFn: () => client.mcp.startOAuth({ id }) });
};

export const useDisconnectOAuth = (id: LibraryItemId) => {
  const client = useLibraryClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => client.mcp.disconnect({ id }),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: libraryKeys.mcpStatus(id) }),
  });
};

/** An oRPC error's code, whether it came over HTTP or from the fake client. */
export const errorCode = (error: unknown): string | undefined =>
  typeof error === "object" && error !== null && "code" in error
    ? String((error as { code: unknown }).code)
    : undefined;

const isCode = (error: unknown, code: string): boolean =>
  errorCode(error) === code;

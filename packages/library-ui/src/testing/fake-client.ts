import {
  agentItem,
  fixtureId,
  fixtureTime,
  me,
  modelOptions,
  org,
  publicConfig,
  reviewerDefinition,
  teamEngineering,
  teamPlatform,
  userAda,
  userBo,
} from "@workspace/contract/fixtures";
import type {
  GrantId,
  LibraryItemId,
  LibraryVersionId,
  ShareLinkId,
} from "@workspace/contract/schemas/common";
import type {
  ResourceGrant,
  ShareLink,
} from "@workspace/contract/schemas/grants";
import type {
  LibraryDefinition,
  LibraryExport,
  LibraryItem,
  LibraryItemDetail,
  LibraryVersion,
  McpConnectionStatus,
} from "@workspace/contract/schemas/library";
import { libraryDefinitionInputSchema } from "@workspace/contract/schemas/library";
import type { Principal } from "@workspace/contract/schemas/tenancy";
import { newId } from "@workspace/shared/ids";

import { definitionView } from "../cache";
import type { LibraryClient } from "../client";

// An in-memory `LibraryClient` for the `/dev/library` demo and component
// tests. It keeps the rules that matter on screen (drafts vs versions,
// `use` hides the definition, grants replace per principal) and nothing
// else. `failNext` makes the next call to a procedure throw, to see
// optimistic edits roll back.

export interface FakeError extends Error {
  readonly code: string;
}

const fail = (code: string, message = code): FakeError =>
  Object.assign(new Error(message), { code });

interface StoredItem {
  /** The draft's definition; `item.definition` is what the caller sees. */
  draft: LibraryDefinition;
  item: LibraryItemDetail;
  versions: LibraryVersion[];
}

export interface FakeLibraryClient extends LibraryClient {
  /** The next call to `group.procedure` rejects with `code`. */
  readonly failNext: (procedure: string, code?: string) => void;
  /** How long each call takes, to see pending states. */
  readonly setLatency: (ms: number) => void;
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

const versioned = (kind: LibraryItem["kind"]) =>
  kind === "agent" || kind === "prompt" || kind === "skill";

const promptItem = (): StoredItem => {
  const definition: LibraryDefinition = {
    command: "explain",
    kind: "prompt",
    template: "Explain {{topic}} to {{audience}}, with one example.",
    variables: [
      { description: "What to explain", name: "topic" },
      { default: "a new hire", description: "Who it's for", name: "audience" },
    ],
  };
  const id = fixtureId("libraryItem", 20);
  const version: LibraryVersion = {
    createdAt: fixtureTime(2),
    createdBy: userAda.id,
    definition,
    id: fixtureId("libraryVersion", 20),
    itemId: id,
    notes: null,
    number: 1,
    publishedAt: fixtureTime(2),
    status: "published",
  };
  return {
    draft: definition,
    item: {
      ...agentItem,
      definition,
      description: "Plain-language explainer.",
      draftVersionId: fixtureId("libraryVersion", 21),
      icon: null,
      id,
      kind: "prompt",
      latestVersionId: version.id,
      latestVersionNumber: 1,
      maintainers: [],
      myAccess: "owner",
      name: "Explain a concept",
      owner: { id: userAda.id, type: "user" },
      publishedFrom: null,
      updatedAt: fixtureTime(4),
      versionId: fixtureId("libraryVersion", 21),
      visibility: "shared",
    },
    versions: [version],
  };
};

const skillItem = (): StoredItem => {
  const definition: LibraryDefinition = {
    files: [
      { fileId: fixtureId("file", 31), path: "scripts/check.sh" },
      { fileId: fixtureId("file", 32), path: "reference/style.md" },
    ],
    kind: "skill",
    skillMd:
      "---\nname: changelog\ndescription: Writes a changelog entry from a diff.\n---\n\n# Changelog\n\nRun `scripts/check.sh` first, then follow `reference/style.md`.\n",
  };
  return {
    draft: definition,
    item: {
      ...agentItem,
      definition,
      description: "Writes a changelog entry from a diff.",
      draftVersionId: fixtureId("libraryVersion", 31),
      icon: null,
      id: fixtureId("libraryItem", 30),
      kind: "skill",
      latestVersionId: null,
      latestVersionNumber: null,
      maintainers: [],
      myAccess: "owner",
      name: "Changelog",
      owner: { id: userAda.id, type: "user" },
      publishedFrom: null,
      updatedAt: fixtureTime(5),
      versionId: fixtureId("libraryVersion", 31),
      visibility: "private",
    },
    versions: [],
  };
};

const mcpItem = (): StoredItem => {
  const definition: LibraryDefinition = {
    auth: { configured: true, headerName: "Authorization", type: "header" },
    kind: "mcp_server",
    transport: "http",
    url: "https://mcp.example.test/mcp",
  };
  return {
    draft: definition,
    item: {
      ...agentItem,
      definition,
      description: "Internal docs search.",
      draftVersionId: null,
      icon: null,
      id: fixtureId("libraryItem", 3),
      kind: "mcp_server",
      latestVersionId: null,
      latestVersionNumber: null,
      maintainers: [],
      myAccess: "owner",
      name: "Docs",
      owner: { id: userAda.id, type: "user" },
      publishedFrom: null,
      updatedAt: fixtureTime(3),
      versionId: null,
      visibility: "private",
    },
    versions: [],
  };
};

const sharedAgent = (): StoredItem => ({
  draft: { ...reviewerDefinition, instructions: "Summarise meetings." },
  item: {
    ...agentItem,
    definition: null,
    description: "Turns a transcript into decisions and actions.",
    draftVersionId: null,
    id: fixtureId("libraryItem", 40),
    maintainers: [],
    myAccess: "use",
    name: "Meeting notes",
    owner: { id: userBo.id, type: "user" },
    publishedFrom: null,
    updatedAt: fixtureTime(6),
    visibility: "shared",
  },
  versions: [],
});

const teamAgent = (): StoredItem => ({
  draft: reviewerDefinition,
  item: { ...agentItem, definition: reviewerDefinition },
  versions: [
    {
      createdAt: fixtureTime(),
      createdBy: userAda.id,
      definition: { ...reviewerDefinition, instructions: "Review diffs." },
      id: fixtureId("libraryVersion", 1),
      itemId: agentItem.id,
      notes: "First cut.",
      number: 1,
      publishedAt: fixtureTime(),
      status: "published",
    },
    {
      createdAt: fixtureTime(1),
      createdBy: userAda.id,
      definition: reviewerDefinition,
      id: fixtureId("libraryVersion", 2),
      itemId: agentItem.id,
      notes: "Stricter about naming.",
      number: 2,
      publishedAt: fixtureTime(1),
      status: "published",
    },
  ],
});

const toListItem = ({ item }: StoredItem): LibraryItem => {
  const { definition: _definition, versionId: _versionId, ...rest } = item;
  return rest;
};

const exportOf = (stored: StoredItem): LibraryExport => ({
  definition: stored.draft,
  description: stored.item.description,
  exportedAt: new Date().toISOString(),
  format: "native",
  formatVersion: 1,
  icon: stored.item.icon,
  name: stored.item.name,
});

/** A fake API seeded with a few items across the three tabs. */
export const createFakeLibraryClient = (
  options: { readonly empty?: boolean } = {}
): FakeLibraryClient => {
  const items = new Map<string, StoredItem>();
  const grants = new Map<string, ResourceGrant>();
  const links = new Map<string, ShareLink>();
  const failures = new Map<string, string>();
  let latency = 0;

  if (!options.empty) {
    for (const seed of [
      teamAgent(),
      promptItem(),
      skillItem(),
      mcpItem(),
      sharedAgent(),
    ]) {
      items.set(seed.item.id, seed);
    }
    const shared: ResourceGrant = {
      createdAt: fixtureTime(4),
      grantedBy: userAda.id,
      id: fixtureId("grant", 20),
      permission: "view",
      principal: { id: userBo.id, type: "user" },
      resourceId: fixtureId("libraryItem", 20),
      resourceType: "prompt",
    };
    grants.set(shared.id, shared);
  }

  /** Waits, then throws if the test asked this procedure to fail. */
  const gate = async (procedure: string) => {
    if (latency > 0) {
      await sleep(latency);
    }
    const code = failures.get(procedure);
    if (code) {
      failures.delete(procedure);
      throw fail(code, `The server refused ${procedure}.`);
    }
  };

  const find = (id: string): StoredItem => {
    const found = items.get(id);
    if (!found) {
      throw fail("NOT_FOUND");
    }
    return found;
  };

  const detail = (
    stored: StoredItem,
    revision = "draft"
  ): LibraryItemDetail => {
    const { item } = stored;
    if (item.myAccess === "use") {
      return { ...item, definition: null };
    }
    if (revision === "latest" && versioned(item.kind)) {
      const latest = stored.versions.at(-1);
      return {
        ...item,
        definition: latest?.definition ?? null,
        versionId: latest?.id ?? null,
      };
    }
    return { ...item, definition: stored.draft };
  };

  const touch = (stored: StoredItem) => {
    stored.item = { ...stored.item, updatedAt: new Date().toISOString() };
  };

  const create = (
    input: {
      readonly definition: unknown;
      readonly description?: string;
      readonly icon?: string | null;
      readonly name: string;
    },
    owner: Principal = { id: userAda.id, type: "user" }
  ): StoredItem => {
    const id = newId("libraryItem") as LibraryItemId;
    const definition = definitionView(
      libraryDefinitionInputSchema.parse(input.definition),
      null
    );
    const isVersioned = versioned(definition.kind);
    const draftId = isVersioned
      ? (newId("libraryVersion") as LibraryVersionId)
      : null;
    const now = new Date().toISOString();
    const stored: StoredItem = {
      draft: definition,
      item: {
        createdAt: now,
        createdBy: userAda.id,
        definition,
        description: input.description ?? "",
        draftVersionId: draftId,
        icon: input.icon ?? null,
        id,
        kind: definition.kind,
        latestVersionId: null,
        latestVersionNumber: null,
        maintainers: [],
        myAccess: owner.type === "user" ? "owner" : "maintainer",
        name: input.name,
        owner,
        publishedFrom: null,
        updatedAt: now,
        versionId: draftId,
        visibility: owner.type === "user" ? "private" : "published",
      },
      versions: [],
    };
    items.set(id, stored);
    return stored;
  };

  const publish = (stored: StoredItem, notes: string | null) => {
    const last = stored.versions.at(-1);
    if (
      last &&
      JSON.stringify(last.definition) === JSON.stringify(stored.draft)
    ) {
      throw fail("CONFLICT", "Nothing changed since the last version.");
    }
    const number = (last?.number ?? 0) + 1;
    const now = new Date().toISOString();
    const version: LibraryVersion = {
      createdAt: now,
      createdBy: userAda.id,
      definition: stored.draft,
      id: newId("libraryVersion") as LibraryVersionId,
      itemId: stored.item.id,
      notes,
      number,
      publishedAt: now,
      status: "published",
    };
    stored.versions.push(version);
    stored.item = {
      ...stored.item,
      latestVersionId: version.id,
      latestVersionNumber: number,
      updatedAt: now,
    };
    return version;
  };

  const client: FakeLibraryClient = {
    failNext: (procedure, code = "VALIDATION") => {
      failures.set(procedure, code);
    },
    grants: {
      create: async (input) => {
        await gate("grants.create");
        const existing = [...grants.values()].find(
          (each) =>
            each.resourceId === input.resourceId &&
            each.principal.type === input.principal.type &&
            each.principal.id === input.principal.id
        );
        const grant = {
          ...input,
          createdAt: new Date().toISOString(),
          grantedBy: userAda.id,
          id: existing?.id ?? (newId("grant") as GrantId),
        } as ResourceGrant;
        grants.set(grant.id, grant);
        const stored = items.get(input.resourceId);
        if (stored?.item.visibility === "private") {
          stored.item = { ...stored.item, visibility: "shared" };
        }
        return grant;
      },
      list: async (ref) => {
        await gate("grants.list");
        return [...grants.values()].filter(
          (each) => each.resourceId === ref.resourceId
        );
      },
      revoke: async ({ id }) => {
        await gate("grants.revoke");
        grants.delete(id);
      },
      update: async ({ id, permission }) => {
        await gate("grants.update");
        const grant = grants.get(id);
        if (!grant) {
          throw fail("NOT_FOUND");
        }
        const next = { ...grant, permission } as ResourceGrant;
        grants.set(id, next);
        return next;
      },
    },
    library: {
      create: async (input) => {
        await gate("library.create");
        return detail(create(input));
      },
      delete: async ({ id }) => {
        await gate("library.delete");
        find(id);
        items.delete(id);
      },
      duplicate: async ({ id, name }) => {
        await gate("library.duplicate");
        const source = find(id);
        const copy = create({
          definition: source.draft,
          description: source.item.description,
          name: name ?? source.item.name,
        });
        return detail(copy);
      },
      export: async ({ id }) => {
        await gate("library.export");
        return exportOf(find(id));
      },
      get: async ({ id, revision }) => {
        await gate("library.get");
        return detail(find(id), revision);
      },
      getVersion: async ({ id, versionId }) => {
        await gate("library.getVersion");
        const version = find(id).versions.find((each) => each.id === versionId);
        if (!version) {
          throw fail("NOT_FOUND");
        }
        return version;
      },
      import: async ({ document }) => {
        await gate("library.import");
        if (document.format !== "native") {
          throw fail("VALIDATION", "Only native exports in the demo.");
        }
        return detail(
          create({
            definition: document.definition,
            description: document.description,
            name: document.name,
          })
        );
      },
      list: async (input) => {
        await gate("library.list");
        const query = input.query?.toLowerCase();
        const all = [...items.values()]
          .filter(({ item }) => {
            if (input.tab === "mine") {
              return item.owner.type === "user" && item.owner.id === userAda.id;
            }
            if (input.tab === "shared") {
              return item.owner.type === "user" && item.owner.id !== userAda.id;
            }
            return item.owner.type !== "user";
          })
          .filter(({ item }) => !input.kind || item.kind === input.kind)
          .filter(
            ({ item }) =>
              !query ||
              item.name.toLowerCase().includes(query) ||
              item.description.toLowerCase().includes(query)
          )
          .sort((a, b) => b.item.updatedAt.localeCompare(a.item.updatedAt));
        return { items: all.map(toListItem), nextCursor: null };
      },
      listVersions: async ({ id }) => {
        await gate("library.listVersions");
        const stored = find(id);
        const draft: LibraryVersion[] =
          stored.item.draftVersionId && stored.item.myAccess !== "use"
            ? [
                {
                  createdAt: stored.item.updatedAt,
                  createdBy: userAda.id,
                  definition: stored.draft,
                  id: stored.item.draftVersionId,
                  itemId: stored.item.id,
                  notes: null,
                  number: null,
                  publishedAt: null,
                  status: "draft",
                },
              ]
            : [];
        return {
          items: [...stored.versions].reverse().concat(draft),
          nextCursor: null,
        };
      },
      publishToLibrary: async ({ id, target }) => {
        await gate("library.publishToLibrary");
        const source = find(id);
        const copy = create(
          {
            definition: source.draft,
            description: source.item.description,
            name: source.item.name,
          },
          target as Principal
        );
        copy.item = {
          ...copy.item,
          maintainers: [userAda],
          publishedFrom: source.item.id,
        };
        if (versioned(copy.item.kind)) {
          publish(copy, source.versions.at(-1)?.notes ?? null);
        }
        return detail(copy, "latest");
      },
      publishVersion: async ({ id, notes }) => {
        await gate("library.publishVersion");
        const stored = find(id);
        return publish(stored, notes ?? null);
      },
      restoreVersion: async ({ id, versionId }) => {
        await gate("library.restoreVersion");
        const stored = find(id);
        const version = stored.versions.find((each) => each.id === versionId);
        if (!version) {
          throw fail("NOT_FOUND");
        }
        stored.draft = version.definition;
        touch(stored);
        return detail(stored);
      },
      update: async ({ definition, description, icon, id, name }) => {
        await gate("library.update");
        const stored = find(id);
        if (stored.item.myAccess === "use" || stored.item.myAccess === "view") {
          throw fail("FORBIDDEN");
        }
        if (definition) {
          stored.draft = definitionView(
            libraryDefinitionInputSchema.parse(definition),
            stored.draft
          );
        }
        stored.item = {
          ...stored.item,
          ...(name === undefined ? {} : { name }),
          ...(description === undefined ? {} : { description }),
          ...(icon === undefined ? {} : { icon }),
        };
        touch(stored);
        return detail(stored);
      },
    },
    mcp: {
      disconnect: async () => {
        await gate("mcp.disconnect");
      },
      startOAuth: async () => {
        await gate("mcp.startOAuth");
        return { authorizationUrl: "https://auth.example.test/authorize" };
      },
      status: async ({ id }): Promise<McpConnectionStatus> => {
        await gate("mcp.status");
        const stored = find(id);
        const definition = stored.draft;
        if (definition.kind !== "mcp_server") {
          return { state: "disabled" };
        }
        if (definition.auth.type === "oauth") {
          return { state: "needs_auth" };
        }
        return { state: "connected", toolCount: 4 };
      },
    },
    me: {
      get: async () => {
        await gate("me.get");
        return me;
      },
    },
    meta: {
      config: async () => {
        await gate("meta.config");
        return publicConfig;
      },
      models: async () => {
        await gate("meta.models");
        return modelOptions;
      },
    },
    orgs: {
      members: async () => {
        await gate("orgs.members");
        return {
          items: [userAda, userBo].map((user) => ({
            joinedAt: fixtureTime(),
            role: user.id === userAda.id ? "owner" : "member",
            teams: [],
            user,
          })) as never,
          nextCursor: null,
        };
      },
    },
    setLatency: (ms) => {
      latency = ms;
    },
    shareLinks: {
      create: async (ref) => {
        await gate("shareLinks.create");
        const token = newId("x").replaceAll("-", "");
        const link = {
          ...ref,
          createdAt: new Date().toISOString(),
          createdBy: userAda.id,
          expiresAt: null,
          id: newId("shareLink") as ShareLinkId,
          revokedAt: null,
          token,
          url: `https://chat.example.test/share/${token}`,
        } as ShareLink;
        links.set(link.id, link);
        return link;
      },
      list: async (ref) => {
        await gate("shareLinks.list");
        return [...links.values()].filter(
          (each) => each.resourceId === ref.resourceId && !each.revokedAt
        );
      },
      revoke: async ({ id }) => {
        await gate("shareLinks.revoke");
        links.delete(id);
      },
    },
  };
  return client;
};

/** The demo's teams and org, for publish targets. */
export const fakeLibraries = { org, teamEngineering, teamPlatform };

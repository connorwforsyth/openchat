import type { LibraryItemId, UserId } from "@workspace/contract/schemas/common";
import type { Principal } from "@workspace/contract/schemas/tenancy";
import type { Db } from "@workspace/db/client";
import {
  createMcpServer,
  createPreset,
  createVersionedItem,
  type ItemPatch,
  updateDraft,
  updateItemMeta,
  updateMcpServer,
} from "@workspace/db/queries/library";
import {
  replaceSkillFiles,
  touchLibraryItem,
  updatePreset,
} from "@workspace/db/queries/library-items";
import { getMcpServer } from "@workspace/db/queries/mcp";

import type { PreparedDefinition, SecretChange } from "./definitions";

// Writing a prepared definition, whatever the kind: the versioned kinds
// into their draft, MCP servers and presets in place.

export interface ItemMeta {
  readonly description: string;
  readonly icon: string | null;
  readonly name: string;
}

const secretOf = (change: SecretChange) =>
  change.type === "set" ? change.sealed : undefined;

/** Creates an item owned by `owner`; returns its id. */
export const storeNewItem = async (
  db: Db,
  input: {
    readonly createdBy: UserId;
    readonly meta: ItemMeta;
    readonly owner: Principal;
    readonly prepared: PreparedDefinition;
    /** For copies: the secret already sealed on the source (never re-read in the clear). */
    readonly copiedSecret?: {
      readonly ciphertext: string;
      readonly keyId: string;
    };
  }
): Promise<LibraryItemId> => {
  const { meta, prepared } = input;
  const base = {
    createdBy: input.createdBy,
    description: meta.description,
    icon: meta.icon,
    name: meta.name,
    owner: input.owner,
  };
  switch (prepared.kind) {
    case "agent":
    case "prompt": {
      const created = await createVersionedItem(db, prepared.kind, {
        ...base,
        definition: prepared.definition as never,
      });
      return created.item.id;
    }
    case "skill": {
      const created = await createVersionedItem(db, "skill", {
        ...base,
        definition: prepared.definition,
      });
      await replaceSkillFiles(db, created.draft.id, prepared.files);
      return created.item.id;
    }
    case "mcp_server": {
      const secret = input.copiedSecret ?? secretOf(prepared.secret);
      const { auth } = prepared.definition;
      const row = await createMcpServer(db, {
        ...base,
        definition:
          auth.type === "header"
            ? {
                ...prepared.definition,
                auth: { ...auth, configured: secret !== undefined },
              }
            : prepared.definition,
        secret,
      });
      return row.id;
    }
    case "preset": {
      const row = await createPreset(db, {
        ...base,
        definition: prepared.definition,
      });
      return row.id;
    }
    default:
      return prepared satisfies never;
  }
};

const hasMeta = (patch: ItemPatch): boolean =>
  patch.name !== undefined ||
  patch.description !== undefined ||
  patch.icon !== undefined;

const updateVersioned = async (
  db: Db,
  kind: "agent" | "prompt" | "skill",
  id: LibraryItemId,
  patch: ItemPatch,
  prepared?: PreparedDefinition
): Promise<void> => {
  if (hasMeta(patch)) {
    await updateItemMeta(db, kind, id, patch);
  }
  if (prepared?.kind === "agent" || prepared?.kind === "prompt") {
    await updateDraft(db, prepared.kind, id, prepared.definition as never);
  } else if (prepared?.kind === "skill") {
    const draft = await updateDraft(db, "skill", id, prepared.definition);
    if (draft.ok) {
      await replaceSkillFiles(db, draft.value.id, prepared.files);
    }
  }
  if (prepared) {
    await touchLibraryItem(db, kind, id);
  }
};

const updateMcp = async (
  db: Db,
  id: LibraryItemId,
  patch: ItemPatch,
  prepared?: PreparedDefinition
): Promise<void> => {
  const definition = prepared?.kind === "mcp_server" ? prepared : undefined;
  if (!(definition || hasMeta(patch))) {
    return;
  }
  const secret =
    !definition || definition.secret.type === "keep"
      ? {}
      : { secret: secretOf(definition.secret) ?? null };
  await updateMcpServer(db, id, {
    ...patch,
    ...(definition ? { definition: definition.definition } : {}),
    ...secret,
  });
};

/** Applies a meta patch and (optionally) a new definition to an existing item. */
export const storeUpdate = async (
  db: Db,
  kind: PreparedDefinition["kind"],
  id: LibraryItemId,
  patch: ItemPatch,
  prepared?: PreparedDefinition
): Promise<void> => {
  switch (kind) {
    case "agent":
    case "prompt":
    case "skill":
      return await updateVersioned(db, kind, id, patch, prepared);
    case "mcp_server":
      return await updateMcp(db, id, patch, prepared);
    case "preset": {
      const definition =
        prepared?.kind === "preset" ? prepared.definition : undefined;
      if (definition || hasMeta(patch)) {
        await updatePreset(db, id, { ...patch, definition });
      }
      return;
    }
    default:
      return kind satisfies never;
  }
};

/** The sealed secret stored on an MCP server, for publishing a copy of it. */
export const sealedSecretOf = async (
  db: Db,
  id: LibraryItemId
): Promise<
  { readonly ciphertext: string; readonly keyId: string } | undefined
> => {
  const found = await getMcpServer(db, id);
  return found.ok && found.value.secretCiphertext && found.value.secretKeyId
    ? {
        ciphertext: found.value.secretCiphertext,
        keyId: found.value.secretKeyId,
      }
    : undefined;
};

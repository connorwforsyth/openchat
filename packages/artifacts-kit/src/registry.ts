import { err, type Result } from "@workspace/shared/result";

import {
  type ArtifactKindDefinition,
  applyArtifactOperation,
  checkArtifact,
  modelViewOf,
  reportArtifactOperation,
  storedFromModel,
} from "./define";

// The kinds an instance offers, by name. Built once from a list of
// definitions; later layers (the instance's config, an org, an agent) will
// narrow it, never widen it (the proposal's "Rules come in layers").

export interface ArtifactKindRegistry {
  /** Why `content` isn't a valid version of `kind`; a kind it doesn't have is a problem too. */
  readonly check: (kind: string, content: unknown) => readonly string[];
  /** Applies one of a kind's operations to a stored version (`applyArtifactOperation`). */
  readonly edit: (
    kind: string,
    stored: string | null,
    operation: string,
    input: unknown
  ) => Result<string, readonly string[]>;
  /** The stored text for what the model wrote (`storedFromModel`). */
  readonly fromModel: (kind: string, text: string) => string;
  readonly get: (kind: string) => ArtifactKindDefinition | undefined;
  /** Each kind's instructions as a prompt file, for kinds that have any. */
  readonly instructionFiles: () => readonly {
    readonly source: string;
    readonly text: string;
  }[];
  readonly kinds: readonly string[];
  readonly list: () => readonly ArtifactKindDefinition[];
  /** What an `edit` with these arguments changes (`reportArtifactOperation`). */
  readonly report: (
    kind: string,
    stored: string | null,
    operation: string,
    input: unknown
  ) => readonly string[];
  /** What the model reads of a stored version (`modelViewOf`). */
  readonly toModel: (kind: string, stored: string) => string;
}

/**
 * A registry over `definitions`, in their order. Two with the same `kind`
 * is a mistake in the code that lists them, so it throws.
 */
export const createArtifactKindRegistry = (
  definitions: readonly ArtifactKindDefinition[]
): ArtifactKindRegistry => {
  const byKind = new Map<string, ArtifactKindDefinition>();
  for (const definition of definitions) {
    if (byKind.has(definition.kind)) {
      throw new Error(`artifact kind "${definition.kind}" is defined twice`);
    }
    byKind.set(definition.kind, definition);
  }
  const all = [...byKind.values()];
  return {
    check: (kind, content) => {
      const definition = byKind.get(kind);
      return definition
        ? checkArtifact(definition, content)
        : [`"${kind}" isn't an artifact kind here`];
    },
    edit: (kind, stored, operation, input) => {
      const definition = byKind.get(kind);
      return definition
        ? applyArtifactOperation(definition, stored, operation, input)
        : err([`"${kind}" isn't an artifact kind here`]);
    },
    fromModel: (kind, text) => {
      const definition = byKind.get(kind);
      return definition ? storedFromModel(definition, text) : text;
    },
    get: (kind) => byKind.get(kind),
    instructionFiles: () =>
      all
        .filter((definition) => definition.instructions !== "")
        .map((definition) => ({
          source: `kinds/${definition.kind}`,
          text: definition.instructions,
        })),
    kinds: all.map((definition) => definition.kind),
    list: () => all,
    report: (kind, stored, operation, input) => {
      const definition = byKind.get(kind);
      return definition
        ? reportArtifactOperation(definition, stored, operation, input)
        : [];
    },
    toModel: (kind, stored) => {
      const definition = byKind.get(kind);
      return definition ? modelViewOf(definition, stored) : stored;
    },
  };
};

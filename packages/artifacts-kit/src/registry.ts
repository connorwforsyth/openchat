import { type ArtifactKindDefinition, checkArtifact } from "./define";

// The kinds an instance offers, by name. Built once from a list of
// definitions; later layers (the instance's config, an org, an agent) will
// narrow it, never widen it (the proposal's "Rules come in layers").

export interface ArtifactKindRegistry {
  /** Why `content` isn't a valid version of `kind`; a kind it doesn't have is a problem too. */
  readonly check: (kind: string, content: unknown) => readonly string[];
  readonly get: (kind: string) => ArtifactKindDefinition | undefined;
  /** Each kind's instructions as a prompt file, for kinds that have any. */
  readonly instructionFiles: () => readonly {
    readonly source: string;
    readonly text: string;
  }[];
  readonly kinds: readonly string[];
  readonly list: () => readonly ArtifactKindDefinition[];
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
  };
};

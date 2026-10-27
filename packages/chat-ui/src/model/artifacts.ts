import { builtinKindDefinitions } from "@workspace/artifacts-kit/builtin";
import type { ArtifactKind } from "@workspace/contract/schemas/message-parts";
import type { ProposedEdit } from "@workspace/contract/schemas/runs";
import { structuredPatch } from "diff";

// Artifacts panel helpers (D16): a file name for each artifact so CodeView
// picks a language, the before/after diff between two versions as the same
// `ProposedEdit` shape DiffView reviews, and which kinds preview in a frame.
// What differs per kind (its file extension, how the panel shows it) comes
// from the kind's definition in `@workspace/artifacts-kit` (124).

/** The kind's first export's extension; `txt` for a kind that has none. */
const extensionOf = (kind: ArtifactKind): string =>
  builtinKindDefinitions[kind].export[0]?.extension ?? "txt";

// Shiki language ids that don't double as a file extension.
const extensionByLanguage: Readonly<Record<string, string>> = {
  bash: "sh",
  javascript: "js",
  python: "py",
  ruby: "rb",
  rust: "rs",
  shell: "sh",
  typescript: "ts",
  yaml: "yml",
};

const UNSAFE_NAME = /[^\w.-]+/g;
const EDGE_DASHES = /^-+|-+$/g;

/** A file name for the artifact, so viewers infer the language from it. */
export const artifactFileName = (
  title: string,
  kind: ArtifactKind,
  language: string | null
): string => {
  const base =
    title.trim().replace(UNSAFE_NAME, "-").replace(EDGE_DASHES, "") ||
    "artifact";
  if (base.includes(".")) {
    return base;
  }
  const extension =
    kind === "code" && language
      ? (extensionByLanguage[language] ?? language)
      : extensionOf(kind);
  return `${base}.${extension}`;
};

/**
 * The change from one version's content to another's, as a unified diff with
 * hunk ids, or `null` when nothing changed.
 */
export const versionEdit = (
  path: string,
  before: string,
  after: string
): ProposedEdit | null => {
  const { hunks } = structuredPatch(path, path, before, after, "", "", {
    context: 3,
  });
  if (hunks.length === 0) {
    return null;
  }
  const patch = hunks
    .map(
      (hunk) =>
        `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@\n${hunk.lines.join("\n")}\n`
    )
    .join("");
  return {
    hunks: hunks.map((hunk, index) => ({
      hunkId: `h${index + 1}`,
      newLines: hunk.newLines,
      newStart: hunk.newStart,
      oldLines: hunk.oldLines,
      oldStart: hunk.oldStart,
    })),
    patch,
    path,
  };
};

/** How the panel shows an artifact besides its source. */
export type ArtifactPreviewKind = "frame" | "image" | "markdown" | "none";

export const previewKind = (kind: ArtifactKind): ArtifactPreviewKind => {
  const { panel } = builtinKindDefinitions[kind].render;
  switch (panel) {
    case "frame":
    case "image":
    case "markdown":
      return panel;
    // React needs a bundler in the frame, and Mermaid a renderer; the panel
    // leaves both to the artifact runtime and says so without it. Code is
    // its source. A document (126) is its editor, a diagram (165) its
    // canvas, and a spreadsheet (166) its grid, which the view picks first.
    case "source":
    case "diagram":
    case "document":
    case "spreadsheet":
      return "none";
    default:
      return panel satisfies never;
  }
};

/**
 * How an artifact shows as itself: the runtime's render, the panel's own (a
 * frame, a picture, Markdown), why it can't (a kind only the runtime draws,
 * on an instance without one), or its source for a kind whose source is the
 * whole of it (code). It never falls back to source.
 */
export type ArtifactPreviewPlan =
  | { readonly origin: string; readonly type: "runtime" }
  | { readonly panel: "frame" | "image" | "markdown"; readonly type: "panel" }
  | { readonly reason: "no-runtime"; readonly type: "unavailable" }
  | { readonly type: "source" };

/** How `kind` shows, given the runtime's origin (`null` for none). Pure. */
export const previewPlan = (
  kind: ArtifactKind,
  runtimeOrigin: string | null
): ArtifactPreviewPlan => {
  const needsRuntime = builtinKindDefinitions[kind].render.runtime !== null;
  if (runtimeOrigin && needsRuntime) {
    return { origin: runtimeOrigin, type: "runtime" };
  }
  const panel = previewKind(kind);
  if (panel !== "none") {
    return { panel, type: "panel" };
  }
  return needsRuntime
    ? { reason: "no-runtime", type: "unavailable" }
    : { type: "source" };
};

/** The document a preview frame loads (`srcdoc`). */
export const frameDocument = (kind: ArtifactKind, content: string): string =>
  kind === "svg"
    ? `<!doctype html><html><body style="margin:0;display:grid;place-items:center;min-height:100vh">${content}</body></html>`
    : content;

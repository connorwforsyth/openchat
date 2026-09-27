import type { ArtifactKind } from "@workspace/contract/schemas/message-parts";
import type { ProposedEdit } from "@workspace/contract/schemas/runs";
import { structuredPatch } from "diff";

// Artifacts panel helpers (D16): a file name for each artifact so CodeView
// picks a language, the before/after diff between two versions as the same
// `ProposedEdit` shape DiffView reviews, and which kinds preview in a frame.

const extensionByKind: Readonly<Record<ArtifactKind, string>> = {
  code: "txt",
  html: "html",
  markdown: "md",
  mermaid: "mmd",
  react: "tsx",
  svg: "svg",
};

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
      : extensionByKind[kind];
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
export type ArtifactPreviewKind = "frame" | "markdown" | "none";

export const previewKind = (kind: ArtifactKind): ArtifactPreviewKind => {
  switch (kind) {
    case "html":
    case "svg":
      return "frame";
    case "markdown":
      return "markdown";
    // React needs a bundler in the frame, and Mermaid a renderer; both
    // arrive with the artifact runtime (ticket 025). Until then: source only.
    case "react":
    case "mermaid":
    case "code":
      return "none";
    default:
      return kind satisfies never;
  }
};

/** The document a preview frame loads (`srcdoc`). */
export const frameDocument = (kind: ArtifactKind, content: string): string =>
  kind === "svg"
    ? `<!doctype html><html><body style="margin:0;display:grid;place-items:center;min-height:100vh">${content}</body></html>`
    : content;

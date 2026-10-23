import type { Editor, Range } from "@tiptap/core";
import type { Artifact } from "@workspace/contract/schemas/files";

// The document editor's `/` menu, after Notion's and Linear's: the blocks a
// person can start, in menu order, each with the words that find it. The
// labels are Lingui strings in the component (`useBlockLabels`), keyed by
// the same ids, so a block can't be listed without one.

export const BLOCKS = [
  { id: "paragraph", keywords: ["text", "paragraph", "plain", "p"] },
  { id: "heading1", keywords: ["h1", "#", "title"] },
  { id: "heading2", keywords: ["h2", "##", "subtitle"] },
  { id: "heading3", keywords: ["h3", "###"] },
  { id: "bulletList", keywords: ["ul", "bullet", "unordered", "-"] },
  { id: "orderedList", keywords: ["ol", "ordered", "numbered", "1."] },
  { id: "taskList", keywords: ["todo", "task", "checkbox", "checklist", "[]"] },
  { id: "blockquote", keywords: ["quote", "blockquote", "citation", ">"] },
  { id: "codeBlock", keywords: ["code", "snippet", "pre", "```"] },
  { id: "table", keywords: ["table", "grid", "spreadsheet"] },
  { id: "divider", keywords: ["divider", "hr", "rule", "separator", "---"] },
  { id: "image", keywords: ["image", "picture", "photo", "img"] },
  { id: "artifactLink", keywords: ["link", "artifact", "mention", "page"] },
] as const satisfies readonly {
  readonly id: string;
  readonly keywords: readonly string[];
}[];

export type BlockId = (typeof BLOCKS)[number]["id"];

/** An artifact a document can link to. */
export type LinkTarget = Pick<Artifact, "id" | "kind" | "title">;

export type BlockMenuItem =
  | { readonly id: BlockId; readonly kind: "block" }
  | { readonly artifact: LinkTarget; readonly kind: "artifact" };

/**
 * What "Link to artifact" leaves after the `/`: the same Suggestion keeps
 * running, and whatever follows filters the artifacts. Backspace past the
 * colon is back at the blocks.
 */
export const LINK_TRIGGER = "link:";

export type BlockMenuStage =
  | { readonly query: string; readonly stage: "blocks" }
  | { readonly query: string; readonly stage: "link" };

export const blockMenuStage = (query: string): BlockMenuStage =>
  query.startsWith(LINK_TRIGGER)
    ? { query: query.slice(LINK_TRIGGER.length), stage: "link" }
    : { query, stage: "blocks" };

const WORDS = /\s+/;

const matchesBlock = (
  needle: string,
  label: string,
  keywords: readonly string[]
) =>
  [label, ...label.split(WORDS), ...keywords].some((word) =>
    word.toLowerCase().startsWith(needle)
  );

/**
 * The menu for what follows the `/`: the blocks whose label or a word of
 * it, or a keyword, starts with the query; or, in the link stage, the
 * artifacts whose title holds it. A document never links to itself, and
 * with nothing else to link to there is no "Link to artifact".
 */
export const blockMenuItems = (
  query: string,
  labels: Readonly<Record<BlockId, string>>,
  targets: readonly LinkTarget[],
  self: LinkTarget["id"]
): BlockMenuItem[] => {
  const others = targets.filter((target) => target.id !== self);
  const stage = blockMenuStage(query);
  const needle = stage.query.trim().toLowerCase();
  if (stage.stage === "link") {
    return others
      .filter((target) => target.title.toLowerCase().includes(needle))
      .map((artifact) => ({ artifact, kind: "artifact" }));
  }
  return BLOCKS.filter(
    ({ id, keywords }) =>
      (id !== "artifactLink" || others.length > 0) &&
      (needle === "" || matchesBlock(needle, labels[id], keywords))
  ).map(({ id }) => ({ id, kind: "block" }));
};

/** Where a link to an artifact goes: its own page, which the kind's checks allow. */
export const artifactHref = (id: LinkTarget["id"]) => `/artifacts/${id}`;

type Chain = ReturnType<Editor["chain"]>;

/** What each block does to the line once the `/query` is gone. */
const BLOCK_COMMANDS: Record<
  Exclude<BlockId, "image">,
  (chain: Chain) => Chain
> = {
  // The menu moves on to the artifacts.
  artifactLink: (chain) => chain.insertContent(`/${LINK_TRIGGER}`),
  blockquote: (chain) => chain.toggleBlockquote(),
  bulletList: (chain) => chain.toggleBulletList(),
  codeBlock: (chain) => chain.toggleCodeBlock(),
  divider: (chain) => chain.setHorizontalRule(),
  heading1: (chain) => chain.setHeading({ level: 1 }),
  heading2: (chain) => chain.setHeading({ level: 2 }),
  heading3: (chain) => chain.setHeading({ level: 3 }),
  orderedList: (chain) => chain.toggleOrderedList(),
  paragraph: (chain) => chain.setParagraph(),
  table: (chain) =>
    chain.insertTable({ cols: 3, rows: 3, withHeaderRow: true }),
  taskList: (chain) => chain.toggleTaskList(),
};

/**
 * Replaces the `/query` with the block. An image needs its address first,
 * so `askImage` gets the position it goes at.
 */
export const applyBlock = (
  editor: Editor,
  range: Range,
  id: BlockId,
  askImage: (at: number) => void
): void => {
  const chain = editor.chain().focus().deleteRange(range);
  if (id === "image") {
    chain.run();
    askImage(range.from);
    return;
  }
  BLOCK_COMMANDS[id](chain).run();
};

/** Replaces the `/link:query` with the artifact's title, linked, and a space. */
export const insertArtifactLink = (
  editor: Editor,
  range: Range,
  artifact: LinkTarget
): void => {
  editor
    .chain()
    .focus()
    .insertContentAt(range, [
      {
        marks: [{ attrs: { href: artifactHref(artifact.id) }, type: "link" }],
        text: artifact.title,
        type: "text",
      },
      { text: " ", type: "text" },
    ])
    .run();
};

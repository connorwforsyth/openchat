import type { ArtifactCheck } from "../../define";
import type { Document, DocumentBlock, DocumentInline } from "./schema";

// A document's rules beyond its shape (126): links and images go where a
// browser can safely follow them, and it fits in a version.

/** Longest stored document, as JSON. Rich text is several times its Markdown. */
export const DOCUMENT_MAX_CHARS = 1_000_000;

const SAFE_LINK = /^(?:https?:|mailto:|\/(?!\/)|#|\.{0,2}\/)/i;
const SAFE_IMAGE = /^(?:https:|\/(?!\/))/i;

/** Whether an image may load from `url`: over HTTPS or from this app. */
export const isSafeImageUrl = (url: string): boolean =>
  SAFE_IMAGE.test(url.trim());

interface Url {
  readonly kind: "image" | "link";
  readonly url: string;
}

const inlineUrls = (nodes: readonly DocumentInline[] | undefined): Url[] =>
  (nodes ?? []).flatMap((node) =>
    (node.marks ?? []).flatMap((mark) =>
      mark.type === "link"
        ? [{ kind: "link" as const, url: mark.attrs.href }]
        : []
    )
  );

/** Every link and image in a block, in order. */
const blockUrls = (block: DocumentBlock): Url[] => {
  switch (block.type) {
    case "paragraph":
    case "heading":
      return inlineUrls(block.content);
    case "image":
      return [{ kind: "image", url: block.attrs.src }];
    case "blockquote":
      return block.content.flatMap(blockUrls);
    case "bulletList":
    case "orderedList":
    case "taskList":
      return block.content.flatMap((item) => item.content.flatMap(blockUrls));
    case "table":
      return block.content.flatMap((row) =>
        row.content.flatMap((cell) => cell.content.flatMap(blockUrls))
      );
    case "codeBlock":
    case "horizontalRule":
      return [];
    default:
      return block satisfies never;
  }
};

const urlsOf = (document: Document): readonly Url[] =>
  document.content.flatMap(blockUrls);

/**
 * Links are web, mail or in-app addresses, and images load over HTTPS or
 * from this app (its file store): never `javascript:`, `data:` or a file.
 */
export const safeUrls: ArtifactCheck<Document> = {
  name: "urls",
  run: (document) =>
    urlsOf(document).flatMap(({ kind, url }) => {
      const trimmed = url.trim();
      if (kind === "link" && !SAFE_LINK.test(trimmed)) {
        return [
          `the link to "${url}" isn't allowed: links go to http(s), mailto or a path in this app`,
        ];
      }
      if (kind === "image" && !isSafeImageUrl(trimmed)) {
        return [
          `the image "${url}" isn't allowed: images load over https or from this app`,
        ];
      }
      return [];
    }),
};

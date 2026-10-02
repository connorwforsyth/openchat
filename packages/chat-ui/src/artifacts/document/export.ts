import { documentPrintPage } from "@workspace/artifacts-kit/kinds/document/html";
import { documentToMarkdown } from "@workspace/artifacts-kit/kinds/document/markdown";
import type { Document } from "@workspace/artifacts-kit/kinds/document/schema";

import { artifactFileName } from "../../model/artifacts";

// A document out of the app (126), all in the browser: Markdown and Word
// files download, and PDF is the browser's own print dialog over a page
// made for paper, so the server needs no headless browser.

const MD_END = /\.md$/;

/** `name` with `extension`, from the artifact's title. */
export const exportFileName = (title: string, extension: string): string =>
  artifactFileName(title, "document", null).replace(MD_END, `.${extension}`);

const H1 = 1;

/**
 * The document as Markdown, under its title unless it already opens with
 * that title as its heading (plans do). Pure.
 */
export const documentMarkdownFile = (
  document: Document,
  title: string
): string => {
  const body = documentToMarkdown(document);
  const [first] = document.content;
  const opensWithTitle =
    first?.type === "heading" &&
    first.attrs.level === H1 &&
    (first.content ?? [])
      .map((node) => (node.type === "text" ? node.text : ""))
      .join("")
      .trim() === title.trim();
  return opensWithTitle ? body : `# ${title}\n\n${body}`;
};

/** Hands the browser a file to save. */
export const downloadFile = (blob: Blob, name: string): void => {
  const url = URL.createObjectURL(blob);
  const link = window.document.createElement("a");
  link.href = url;
  link.download = name;
  link.rel = "noopener";
  link.style.display = "none";
  window.document.body.append(link);
  link.click();
  link.remove();
  // After the click has started the download.
  setTimeout(() => URL.revokeObjectURL(url), 0);
};

export const exportMarkdown = (document: Document, title: string): void =>
  downloadFile(
    new Blob([documentMarkdownFile(document, title)], {
      type: "text/markdown;charset=utf-8",
    }),
    exportFileName(title, "md")
  );

/** The Word file; `docx` loads only when someone exports one. */
export const exportDocx = async (
  document: Document,
  title: string
): Promise<void> => {
  const { documentToDocxBlob } = await import(
    "@workspace/artifacts-kit/kinds/document/docx"
  );
  downloadFile(
    await documentToDocxBlob(document, title),
    exportFileName(title, "docx")
  );
};

/** How long a print frame stays, in case `afterprint` never comes. */
const PRINT_FRAME_MS = 60_000;

/**
 * Prints the document from a frame of its own (the print page), so the
 * dialog's "Save as PDF" saves just the document, not the app around it.
 */
export const printDocument = (
  document: Document,
  {
    lang,
    meta,
    title,
  }: { readonly lang?: string; readonly meta?: string; readonly title: string }
): void => {
  const frame = window.document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  frame.style.position = "fixed";
  frame.style.width = "0";
  frame.style.height = "0";
  frame.style.border = "0";
  frame.style.opacity = "0";
  frame.srcdoc = documentPrintPage({ document, lang, meta, title });
  const remove = () => frame.remove();
  frame.addEventListener("load", () => {
    const view = frame.contentWindow;
    if (!view) {
      remove();
      return;
    }
    view.addEventListener("afterprint", remove);
    setTimeout(remove, PRINT_FRAME_MS);
    view.focus();
    view.print();
  });
  window.document.body.append(frame);
};

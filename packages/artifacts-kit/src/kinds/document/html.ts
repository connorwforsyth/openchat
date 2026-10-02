import type {
  Document,
  DocumentBlock,
  DocumentInline,
  DocumentMark,
} from "./schema";

// A document as standalone HTML (126), for printing to PDF: the browser's
// own print dialog saves it, so there's no headless browser on the server.
// Text and attributes are escaped, and a link or image whose address the
// kind's checks wouldn't allow is left out, so the page can't run anything.

const ESCAPES: Readonly<Record<string, string>> = {
  "'": "&#39;",
  '"': "&quot;",
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
};
const SPECIAL = /[&<>"']/g;

export const escapeHtml = (text: string): string =>
  text.replace(SPECIAL, (char) => ESCAPES[char] ?? char);

const SAFE_HREF = /^(?:https?:|mailto:|\/|#)/i;
const SAFE_SRC = /^(?:https:|\/(?!\/))/i;

const MARK_TAGS: Readonly<
  Record<Exclude<DocumentMark["type"], "link">, string>
> = {
  bold: "strong",
  code: "code",
  italic: "em",
  strike: "s",
  underline: "u",
};

const inlineHtml = (nodes: readonly DocumentInline[] | undefined): string =>
  (nodes ?? [])
    .map((node) => {
      if (node.type === "hardBreak") {
        return "<br>";
      }
      let out = escapeHtml(node.text);
      for (const mark of node.marks ?? []) {
        if (mark.type === "link") {
          out = SAFE_HREF.test(mark.attrs.href.trim())
            ? `<a href="${escapeHtml(mark.attrs.href)}">${out}</a>`
            : out;
        } else {
          const tag = MARK_TAGS[mark.type];
          out = `<${tag}>${out}</${tag}>`;
        }
      }
      return out;
    })
    .join("");

const blockHtml = (block: DocumentBlock): string => {
  switch (block.type) {
    case "paragraph":
      return `<p>${inlineHtml(block.content)}</p>`;
    case "heading": {
      const { level } = block.attrs;
      return `<h${level}>${inlineHtml(block.content)}</h${level}>`;
    }
    case "blockquote":
      return `<blockquote>${blocksHtml(block.content)}</blockquote>`;
    case "bulletList":
      return `<ul>${block.content.map((item) => `<li>${blocksHtml(item.content)}</li>`).join("")}</ul>`;
    case "orderedList": {
      const start = block.attrs?.start ?? 1;
      return `<ol${start === 1 ? "" : ` start="${start}"`}>${block.content.map((item) => `<li>${blocksHtml(item.content)}</li>`).join("")}</ol>`;
    }
    case "taskList":
      return `<ul class="tasks">${block.content
        .map(
          (item) =>
            `<li><input type="checkbox" disabled${item.attrs?.checked ? " checked" : ""}> ${blocksHtml(item.content)}</li>`
        )
        .join("")}</ul>`;
    case "codeBlock":
      return `<pre><code>${escapeHtml((block.content ?? []).map((node) => node.text).join(""))}</code></pre>`;
    case "horizontalRule":
      return "<hr>";
    case "image": {
      const { alt, src, title } = block.attrs;
      return SAFE_SRC.test(src.trim())
        ? `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt ?? "")}"${title ? ` title="${escapeHtml(title)}"` : ""}>`
        : "";
    }
    case "table":
      return `<table>${block.content
        .map(
          (row) =>
            `<tr>${row.content
              .map((cell) => {
                const tag = cell.type === "tableHeader" ? "th" : "td";
                const span = [
                  cell.attrs?.colspan && cell.attrs.colspan > 1
                    ? ` colspan="${cell.attrs.colspan}"`
                    : "",
                  cell.attrs?.rowspan && cell.attrs.rowspan > 1
                    ? ` rowspan="${cell.attrs.rowspan}"`
                    : "",
                ].join("");
                return `<${tag}${span}>${blocksHtml(cell.content)}</${tag}>`;
              })
              .join("")}</tr>`
        )
        .join("")}</table>`;
    default:
      return block satisfies never;
  }
};

const blocksHtml = (blocks: readonly DocumentBlock[]): string =>
  blocks.map(blockHtml).join("");

/** The document's body as HTML. Pure. */
export const documentToHtml = (document: Document): string =>
  blocksHtml(document.content);

/**
 * The print stylesheet: a serif page in the printer's own black on white,
 * with no colours of the app's theme (paper has no dark mode).
 */
const PRINT_CSS = `@page{margin:2cm}
body{font-family:Georgia,"Times New Roman",serif;font-size:11pt;line-height:1.5;margin:0}
h1.title{font-size:24pt;margin:0 0 4pt}
.meta{font-family:system-ui,sans-serif;font-size:9pt;margin:0 0 18pt;opacity:.7}
h1,h2,h3,h4,h5,h6{break-after:avoid;line-height:1.25;margin:18pt 0 6pt}
p,ul,ol,pre,blockquote,table{margin:0 0 8pt}
blockquote{border-inline-start:2pt solid;margin-inline-start:0;padding-inline-start:10pt;font-style:italic}
pre{font-family:"Courier New",monospace;font-size:9.5pt;white-space:pre-wrap;border:0.5pt solid;padding:6pt}
code{font-family:"Courier New",monospace;font-size:.95em}
table{border-collapse:collapse;width:100%}
th,td{border:0.5pt solid;padding:4pt 6pt;text-align:start;vertical-align:top}
th{font-weight:bold}
ul.tasks{list-style:none;padding-inline-start:0}
img{max-width:100%}
tr,img,pre{break-inside:avoid}`;

/** A whole page to print: the title, a line of details, then the document. Pure. */
export const documentPrintPage = ({
  document,
  lang = "en",
  meta,
  title,
}: {
  readonly document: Document;
  readonly lang?: string;
  /** A line under the title, such as the date and the author. */
  readonly meta?: string;
  readonly title: string;
}): string =>
  [
    `<!doctype html><html lang="${escapeHtml(lang)}"><head><meta charset="utf-8">`,
    `<title>${escapeHtml(title)}</title><style>${PRINT_CSS}</style></head><body>`,
    `<h1 class="title">${escapeHtml(title)}</h1>`,
    meta ? `<p class="meta">${escapeHtml(meta)}</p>` : "",
    documentToHtml(document),
    "</body></html>",
  ].join("");

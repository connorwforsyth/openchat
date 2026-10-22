import { type Browser, chromium, type Page } from "@playwright/test";

import type { RenderObservation } from "./trial";

// Draws a saved artifact the way a person sees it: the chat, with the
// artifact opened in the side panel from its card. Runtime kinds (HTML,
// SVG, React, Mermaid, slides, sites) are drawn by the artifact runtime in
// a frame, which tells the panel `rendered` or `error` over postMessage; we
// listen for the same messages. The panel's own kinds (documents, sheets,
// diagrams, Markdown, code, images) have no such signal, so they pass when
// the kind's view is on screen with no error in the panel.

const RUNTIME_CHANNEL = "artifact-runtime/1";
const RUNTIME_KINDS = new Set([
  "html",
  "mermaid",
  "presentation",
  "react",
  "site",
  "svg",
]);

/** What shows a panel kind is on screen, inside the side panel. */
const PANEL_READY: Readonly<Record<string, string>> = {
  code: "pre, code, .cm-content, [data-slot=code-block]",
  diagram: ".react-flow__node",
  document: ".ProseMirror, [contenteditable=true]",
  image: "img",
  markdown: "h1, h2, h3, p, li",
  spreadsheet: "[data-slot=spreadsheet-grid] canvas",
};

const PANEL = 'aside[aria-label="Side panel"]';
const POLL_MS = 100;

declare global {
  interface Window {
    __artifactRuntime?: { message: string | null; type: string }[];
  }
}

export interface Renderer {
  readonly close: () => Promise<void>;
  readonly render: (target: {
    readonly conversationId: string;
    readonly kind: string;
    readonly screenshot: string;
    readonly title: string;
  }) => Promise<RenderObservation>;
}

const runtimeVerdict = async (page: Page) =>
  (await page.evaluate(() => window.__artifactRuntime ?? [])).find(
    (message) => message.type === "rendered" || message.type === "error"
  ) ?? null;

const panelAlert = async (page: Page): Promise<string | null> => {
  const alert = page.locator(`${PANEL} [role=alert]`).first();
  return (await alert.count()) > 0 ? (await alert.innerText()).trim() : null;
};

const panelReady = async (page: Page, kind: string) => {
  const selector = PANEL_READY[kind];
  return selector
    ? (await page.locator(`${PANEL} :is(${selector})`).count()) > 0
    : false;
};

type Seen = Pick<RenderObservation, "message" | "status">;

/** The panel's verdict so far; `null` while it's still drawing. */
const verdictNow = async (page: Page, kind: string): Promise<Seen | null> => {
  const alert = await panelAlert(page);
  if (RUNTIME_KINDS.has(kind)) {
    const verdict = await runtimeVerdict(page);
    if (verdict) {
      return {
        message: verdict.message,
        status: verdict.type === "rendered" ? "rendered" : "error",
      };
    }
  } else if (await panelReady(page, kind)) {
    return { message: alert, status: alert ? "error" : "rendered" };
  }
  return alert ? { message: alert, status: "error" } : null;
};

export const createRenderer = async ({
  baseUrl,
  cookie,
  timeoutMs = 30_000,
}: {
  readonly baseUrl: string;
  readonly cookie: string;
  readonly timeoutMs?: number;
}): Promise<Renderer> => {
  const browser: Browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { height: 900, width: 1440 },
  });
  const host = new URL(baseUrl).hostname;
  await context.addCookies(
    cookie.split("; ").map((pair) => {
      const at = pair.indexOf("=");
      return {
        domain: host,
        name: pair.slice(0, at),
        path: "/",
        value: pair.slice(at + 1),
      };
    })
  );
  await context.addInitScript((channel) => {
    window.__artifactRuntime = [];
    window.addEventListener("message", (event) => {
      const data = event.data as {
        channel?: string;
        error?: { kind: string; message: string };
        type?: string;
      } | null;
      if (data?.channel === channel && data.type !== "render") {
        window.__artifactRuntime?.push({
          message: data.error
            ? `${data.error.kind}: ${data.error.message}`
            : null,
          type: data.type ?? "",
        });
      }
    });
  }, RUNTIME_CHANNEL);

  const render: Renderer["render"] = async ({
    conversationId,
    kind,
    screenshot,
    title,
  }) => {
    const page = await context.newPage();
    try {
      await page.goto(`${baseUrl}/c/${conversationId}`, {
        timeout: 120_000,
        waitUntil: "domcontentloaded",
      });
      const card = page
        .getByRole("button", { exact: true, name: `Open artifact: ${title}` })
        .last();
      await card.waitFor({ timeout: 60_000 });
      const started = Date.now();
      await card.click();
      const deadline = started + timeoutMs;
      let seen: Seen | null = null;
      while (seen === null && Date.now() < deadline) {
        // biome-ignore lint/performance/noAwaitInLoops: polling the page.
        seen = await verdictNow(page, kind);
        if (seen === null) {
          await page.waitForTimeout(POLL_MS);
        }
      }
      let status = seen?.status ?? "timeout";
      let message = seen?.message ?? null;
      const ms = Date.now() - started;
      // Let the frame paint before the picture.
      await page.waitForTimeout(1500);
      // A deck reports `rendered` and then a slide that failed to draw.
      const late = await panelAlert(page);
      if (late) {
        status = status === "timeout" ? status : "error";
        message ??= late;
      }
      await page.screenshot({ path: screenshot });
      return { message, ms, screenshot, status };
    } finally {
      await page.close();
    }
  };

  return { close: () => browser.close(), render };
};

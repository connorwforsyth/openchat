import { type Browser, expect, type Page, test } from "@playwright/test";
import type { ArtifactId } from "@workspace/contract/schemas/common";

import { apiFor, eventually } from "../support/api";
import { conversationIdOf, expectReply, send } from "../support/chat";
import { storageStateFor } from "../support/users";

// Diagrams (165) as a person meets them. The model writes a flowchart as
// nodes and edges, with no coordinates, and it opens laid out on a canvas
// beside the chat; the model then adds a node by an edit. Ada drags a node
// on the artifact's own page, which saves a version with its place, and
// exports the diagram as Mermaid and SVG.

test.describe.configure({ mode: "serial" });

const APPROVE = /^Approve( all)?$/;
const ARTIFACT_URL = /\/artifacts\/[0-9a-f-]{36}$/;
const TITLE = "Release flow";
const SAVED_V1 = /Tool result: Saved "Release flow" as version 1/;
const SAVED_V2 = /Tool result: Saved "Release flow" as version 2/;
const MERMAID_FILE = /\.mmd$/;
const SVG_FILE = /\.svg$/;
const GRAPH = {
  direction: "LR",
  edges: [
    { from: "build", to: "test" },
    { from: "test", label: "green", to: "ship" },
  ],
  nodes: [
    { id: "build", label: "Build", shape: "stadium" },
    { id: "test", label: "Tests pass?", shape: "diamond" },
    { id: "ship", label: "Ship it" },
  ],
};

const signedIn = async (browser: Browser, baseURL: string) => {
  const context = await browser.newContext({
    acceptDownloads: true,
    baseURL,
    storageState: storageStateFor("ada"),
  });
  const page = await context.newPage();
  return { api: await apiFor(context, baseURL), context, page };
};

/** Approves the one call the run is waiting on. */
const approve = async (page: Page, toolName: string) => {
  const card = page.locator(
    `section[aria-label="Approval needed for ${toolName}"]:not([aria-busy="true"])`
  );
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: APPROVE }).click();
};

const nodeOf = (page: Page, id: string) =>
  page.locator(`[data-diagram-node="${id}"]`);

let made: ArtifactId;

test("the model writes a diagram, then adds a node to it", async ({
  baseURL,
  browser,
}) => {
  const { api, context, page } = await signedIn(browser, baseURL ?? "");
  await page.goto("/");
  await send(
    page,
    `[tool:create_artifact ${JSON.stringify({ content: JSON.stringify(GRAPH), title: TITLE, type: "diagram" })}]`
  );
  await approve(page, "create_artifact");
  await expectReply(page, SAVED_V1);
  const chat = await conversationIdOf(page);
  const [artifact] = await api.artifacts.list({ conversationId: chat });
  expect(artifact).toMatchObject({ kind: "diagram", title: TITLE });
  made = artifact?.id as ArtifactId;

  // It opens beside the chat as a laid-out canvas, flowing left to right.
  await page.getByRole("button", { name: `Open artifact: ${TITLE}` }).click();
  await expect(nodeOf(page, "ship")).toBeVisible();
  await expect(nodeOf(page, "test")).toHaveAttribute("data-shape", "diamond");
  const build = await nodeOf(page, "build").boundingBox();
  const ship = await nodeOf(page, "ship").boundingBox();
  expect((build?.x ?? 0) < (ship?.x ?? 0)).toBe(true);

  await send(
    page,
    `[tool:update_artifact ${JSON.stringify({
      artifactId: made,
      edit: {
        edges: [{ from: "ship", to: "announce" }],
        nodes: [{ id: "announce", label: "Announce" }],
        operation: "add_nodes",
      },
    })}]`
  );
  await approve(page, "update_artifact");
  await expectReply(page, SAVED_V2);
  await expect(nodeOf(page, "announce")).toBeVisible();
  const versions = await api.artifacts.listVersions({ id: made });
  expect(versions).toHaveLength(2);
  expect(versions[1]?.content).toContain('"announce"');
  await context.close();
});

test("Ada drags a node, which saves a version, and exports the diagram", async ({
  baseURL,
  browser,
}) => {
  const { api, context, page } = await signedIn(browser, baseURL ?? "");
  await page.goto("/artifacts");
  await page.getByRole("link", { exact: true, name: TITLE }).click();
  await expect(page).toHaveURL(ARTIFACT_URL);
  const status = page.locator("[data-save-state]");
  await expect(status).toHaveAttribute("data-save-state", "saved");

  const node = nodeOf(page, "build");
  await expect(node).toBeVisible();
  const box = await node.boundingBox();
  const x = (box?.x ?? 0) + (box?.width ?? 0) / 2;
  const y = (box?.y ?? 0) + (box?.height ?? 0) / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 40, y + 120, { steps: 8 });
  await page.mouse.up();
  await expect(status).toHaveAttribute("data-save-state", "saved", {
    timeout: 10_000,
  });

  const versions = await eventually(
    () => api.artifacts.listVersions({ id: made }),
    (each) => each.length === 3
  );
  const [, , latest] = versions;
  expect(latest?.editedBy).toBeTruthy();
  const saved = JSON.parse(latest?.content ?? "{}") as {
    readonly positions?: Readonly<Record<string, unknown>>;
  };
  expect(Object.keys(saved.positions ?? {})).toEqual(["build"]);

  // Mermaid text, then a picture of the canvas.
  await page.getByRole("button", { name: "Export" }).click();
  const [mermaid] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("menuitem", { name: "Mermaid (.mmd)" }).click(),
  ]);
  expect(mermaid.suggestedFilename()).toMatch(MERMAID_FILE);
  const stream = await mermaid.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }
  const text = Buffer.concat(chunks).toString("utf8");
  expect(text).toContain("flowchart LR");
  expect(text).toContain('test -->|"green"| ship');

  await page.getByRole("button", { name: "Export" }).click();
  const [svg] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("menuitem", { name: "SVG image (.svg)" }).click(),
  ]);
  expect(svg.suggestedFilename()).toMatch(SVG_FILE);
  await context.close();
});

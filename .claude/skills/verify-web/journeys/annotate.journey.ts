import { expect, type Locator, type Page } from "@playwright/test";
import { apiFor } from "../../../../e2e/support/api";
import {
  conversationIdOf,
  expectReply,
  send,
  userMessages,
} from "../../../../e2e/support/chat";
import { authState, proof } from "./evidence";
import { test } from "./fixtures";

// Feature: Annotate (features/annotate.md). One pointer on every artifact
// kind: turn it on from the artifact's header, click or drag over the
// artifact, write a note; the notes go back as the next message, joining
// the answer being written. Each kind is made by the mock model, then
// marked where something is, and the note's "where" line shows what the
// layer read there.

test.use({ storageState: authState("ada") });
test.describe.configure({ mode: "serial" });

const APPROVE = /^Approve( all)?$/;
const FINDING = "Finding what's here…";
const ECHO = /Echo:/;
const ARTIFACT_PAGE = /\/artifacts\//;

const approve = async (page: Page, toolName: string) => {
  const card = page.locator(
    `section[aria-label="Approval needed for ${toolName}"]:not([aria-busy="true"])`
  );
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: APPROVE }).click();
};

const workspace = (page: Page) =>
  page.getByRole("region", { name: "Workspace" });

const make = async (
  page: Page,
  directive: string,
  toolName: string,
  title: string
) => {
  await send(page, directive);
  await approve(page, toolName);
  await expectReply(page, new RegExp(`Saved "${title}"|${title}`));
  await page
    .getByRole("button", { name: `Open artifact: ${title}` })
    .last()
    .click();
};

/** The note just placed: waits for the layer to say what's under it. */
const noteFor = async (page: Page, number: number) => {
  const note = page.getByRole("region", { name: `Note ${number}` });
  await expect(note).toBeVisible();
  await expect(note.getByText(FINDING)).toHaveCount(0);
  return note;
};

const centreOf = async (target: Locator) => {
  const box = await target.boundingBox();
  if (!box) {
    throw new Error("target has no box");
  }
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

const pin = async (
  page: Page,
  kind: string,
  target: Locator,
  words: string,
  options: { readonly drag?: boolean } = {}
) => {
  const annotate = workspace(page).getByRole("button", {
    exact: true,
    name: "Annotate",
  });
  await annotate.click();
  const { x, y } = await centreOf(target);
  if (options.drag) {
    await page.mouse.move(x - 30, y - 20);
    await page.mouse.down();
    await page.mouse.move(x + 30, y + 20, { steps: 5 });
    await page.mouse.up();
  } else {
    await page.mouse.click(x, y);
  }
  const note = await noteFor(page, 1);
  const where = (await note.locator("p").first().textContent()) ?? "";
  await note.getByRole("textbox", { name: "Note" }).fill(words);
  await proof(page, "annotate", `${kind}-01-pinned`, { where });
  await note.getByRole("textbox", { name: "Note" }).press("Enter");
  await expect(
    page.getByRole("button", { name: `Note 1: ${words}` })
  ).toBeVisible();
  return where;
};

const sendNotes = async (page: Page, label = "Send notes") => {
  const before = await userMessages(page).count();
  await page
    .getByRole("toolbar", { name: "Annotations" })
    .getByRole("button", { name: label })
    .click();
  await expect(userMessages(page)).toHaveCount(before + 1);
  const sent = userMessages(page).last();
  await expect(sent.locator('[data-slot="message-annotations"]')).toBeVisible();
  return sent;
};

const storedNotes = async (page: Page, baseURL: string | undefined) => {
  const api = await apiFor(page.context(), baseURL ?? "");
  const id = await conversationIdOf(page);
  const path = await api.messages.path({ conversationId: id });
  const last = path.messages.filter((m) => m.role === "user").at(-1);
  return last?.parts;
};

test("a document: a note on a passage names the passage and its heading", async ({
  baseURL,
  page,
}) => {
  await page.goto("/");
  const title = `Trip brief ${Date.now().toString(36)}`;
  const brief = [
    `# ${title}`,
    "",
    "## Plan",
    "Walk the harbour.",
    "",
    "## Packing",
    "- Boots",
  ].join("\n");
  await make(
    page,
    `[tool:create_artifact ${JSON.stringify({ content: brief, title, type: "document" })}]`,
    "create_artifact",
    title
  );
  const where = await pin(
    page,
    "document",
    workspace(page).getByText("Walk the harbour."),
    "Say which harbour."
  );
  expect(where).toContain("Walk the harbour.");

  // A reload keeps the draft; a second tab shows it too.
  await page.reload();
  await page
    .getByRole("button", { name: `Open artifact: ${title}` })
    .last()
    .click();
  await expect(
    page.getByRole("button", { name: "Note 1: Say which harbour." })
  ).toBeVisible();
  await proof(page, "annotate", "document-02-after-reload");
  const other = await page.context().newPage();
  await other.goto(page.url());
  await other
    .getByRole("button", { name: `Open artifact: ${title}` })
    .last()
    .click();
  await expect(
    other.getByRole("button", { name: "Note 1: Say which harbour." })
  ).toBeVisible();
  await proof(other, "annotate", "document-03-second-tab");
  await other.close();

  await sendNotes(page);
  await expectReply(page, ECHO);
  const parts = await storedNotes(page, baseURL);
  await proof(page, "annotate", "document-04-sent", parts);
  expect(JSON.stringify(parts)).toContain('"name":"annotations"');
  expect(JSON.stringify(parts)).toContain("artifact-annotations");
});

test("a site: a note in the page's nested frame names the element", async ({
  page,
}) => {
  await page.goto("/");
  const title = `Harbour site ${Date.now().toString(36)}`;
  const site = JSON.stringify({
    files: {
      "index.html":
        '<!doctype html><html><head><title>Harbour</title></head><body class="p-6"><h1 class="font-bold text-primary">Harbour walks</h1><p>Every Sunday.</p></body></html>',
    },
  });
  await make(
    page,
    `[tool:create_artifact ${JSON.stringify({ content: site, title, type: "site" })}]`,
    "create_artifact",
    title
  );
  const heading = workspace(page)
    .frameLocator(`iframe[title="Preview of ${title}"]`)
    .frameLocator("iframe")
    .getByRole("heading", { name: "Harbour walks" });
  await expect(heading).toBeVisible();
  const where = await pin(page, "site", heading, "Make it bigger.");
  expect(where).toContain("Harbour walks");
});

test("a deck: a note names the slide and what's on it", async ({ page }) => {
  await page.goto("/");
  const title = `Harbour talk ${Date.now().toString(36)}`;
  const slide = (id: string, source: string) => ({
    id,
    source: `import { Bullets, Title } from "@workspace/slide-ui";\n${source}`,
  });
  const deck = JSON.stringify({
    slides: [
      slide("intro", 'export default () => <Title title="Harbour walks" />;'),
      slide(
        "plan",
        'export default () => <Bullets title="The route" items={["The quay", "The lighthouse"]} />;'
      ),
    ],
    title,
  });
  await make(
    page,
    `[tool:create_artifact ${JSON.stringify({ content: deck, title, type: "presentation" })}]`,
    "create_artifact",
    title
  );
  const route = workspace(page)
    .frameLocator("iframe")
    .first()
    .getByText("The lighthouse")
    .first();
  await expect(route).toBeVisible();
  const where = await pin(page, "presentation", route, "Add the pier.");
  expect(where).toContain("Slide");
});

test("a spreadsheet: a box over the grid names the cells", async ({ page }) => {
  await page.goto("/");
  const title = `Costs ${Date.now().toString(36)}`;
  const budget = [
    "## Sheet: Costs",
    "| Item | Cost |",
    "| Rail | 120 |",
    "| Hotel | 300 |",
  ].join("\n");
  await make(
    page,
    `[tool:create_artifact ${JSON.stringify({ content: budget, title, type: "spreadsheet" })}]`,
    "create_artifact",
    title
  );
  const grid = workspace(page).locator('[data-slot="spreadsheet-grid"]');
  await expect(grid).toBeVisible();
  const where = await pin(page, "spreadsheet", grid, "Add a ferry row.", {
    drag: true,
  });
  expect(where).toContain("Cells");
});

test("a diagram: a note names the node", async ({ page }) => {
  await page.goto("/");
  const title = `Release flow ${Date.now().toString(36)}`;
  const graph = {
    direction: "LR",
    edges: [{ from: "build", to: "ship" }],
    nodes: [
      { id: "build", label: "Build" },
      { id: "ship", label: "Ship it" },
    ],
  };
  await make(
    page,
    `[tool:create_artifact ${JSON.stringify({ content: JSON.stringify(graph), title, type: "diagram" })}]`,
    "create_artifact",
    title
  );
  const node = workspace(page).locator('.react-flow__node[data-id="ship"]');
  await expect(node).toBeVisible();
  const where = await pin(page, "diagram", node, "Add a rollback.");
  expect(where).toContain("Ship it");
});

test("a Mermaid diagram: a note names the node in the frame", async ({
  page,
}) => {
  await page.goto("/");
  const title = `Sequence ${Date.now().toString(36)}`;
  await make(
    page,
    `[tool:create_artifact ${JSON.stringify({ content: "flowchart LR\n  A[Start] --> B[Finish]", title, type: "mermaid" })}]`,
    "create_artifact",
    title
  );
  const node = workspace(page)
    .frameLocator(`iframe[title="Preview of ${title}"]`)
    .locator("g.node")
    .first();
  await expect(node).toBeVisible();
  const where = await pin(page, "mermaid", node, "Rename this step.");
  expect(where).toContain("Node");
});

test("an SVG: a box names the part of the drawing", async ({ page }) => {
  await page.goto("/");
  const title = `Badge ${Date.now().toString(36)}`;
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100" width="400" height="200"><rect width="200" height="100" fill="#ddd"/><circle cx="150" cy="50" r="30" fill="#f60"/></svg>';
  await make(
    page,
    `[tool:create_artifact ${JSON.stringify({ content: svg, title, type: "svg" })}]`,
    "create_artifact",
    title
  );
  const circle = workspace(page)
    .frameLocator(`iframe[title="Preview of ${title}"]`)
    .locator("circle");
  await expect(circle).toBeVisible();
  const where = await pin(page, "svg", circle, "Make it round.", {
    drag: true,
  });
  expect(where).toContain("Part of the image");
});

test("while an answer streams, the notes join it", async ({
  baseURL,
  page,
}) => {
  await page.goto("/");
  const title = `Steer brief ${Date.now().toString(36)}`;
  await make(
    page,
    `[tool:create_artifact ${JSON.stringify({ content: `# ${title}\n\nShort text.`, title, type: "document" })}]`,
    "create_artifact",
    title
  );
  await send(page, "[slow] keep going");
  await expect(page.getByRole("button", { name: "Stop" })).toBeVisible();
  await pin(
    page,
    "steer",
    workspace(page).getByText("Short text."),
    "Make it longer."
  );
  await expect(page.getByRole("button", { name: "Send notes" })).toBeVisible();
  await proof(page, "annotate", "steer-02-send-while-busy");
  await page.getByRole("button", { name: "Send notes" }).click();
  await expect(
    page.getByRole("button", { name: "Note 1: Make it longer." })
  ).toHaveCount(0);
  await expectReply(page, ECHO);
  const parts = await storedNotes(page, baseURL);
  await proof(page, "annotate", "steer-03-sent", parts);
  expect(JSON.stringify(parts)).toContain('"name":"annotations"');
});

test("on the artifact's own page, notes wait and Send opens the chat", async ({
  page,
}) => {
  await page.goto("/");
  const title = `Page brief ${Date.now().toString(36)}`;
  await make(
    page,
    `[tool:create_artifact ${JSON.stringify({ content: `# ${title}\n\nOn its own page.`, title, type: "document" })}]`,
    "create_artifact",
    title
  );
  const chat = page.url();
  await page.goto("/artifacts");
  await page.getByRole("link", { name: title }).first().click();
  await expect(page).toHaveURL(ARTIFACT_PAGE);
  const annotate = page.getByRole("button", { exact: true, name: "Annotate" });
  await annotate.click();
  const { x, y } = await centreOf(page.getByText("On its own page."));
  await page.mouse.click(x, y);
  const note = await noteFor(page, 1);
  await note.getByRole("textbox", { name: "Note" }).fill("From the page.");
  await note.getByRole("textbox", { name: "Note" }).press("Enter");
  await proof(page, "annotate", "full-page-01-drafted");
  await page.getByRole("button", { name: "Send in chat" }).click();
  await expect(page).toHaveURL(chat);
  await page
    .getByRole("button", { name: `Open artifact: ${title}` })
    .last()
    .click();
  await expect(
    page.getByRole("button", { name: "Note 1: From the page." })
  ).toBeVisible();
  await proof(page, "annotate", "full-page-02-waiting-in-chat");
});

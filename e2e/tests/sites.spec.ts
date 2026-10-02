import { expect, type Page, test } from "@playwright/test";

import { apiFor } from "../support/api";
import {
  conversationIdOf,
  expectReply,
  openWorkspace,
  send,
} from "../support/chat";
import { storageStateFor } from "../support/users";

// Sites (125). A turn is told how to make one; the mock model makes one; it
// previews in the artifact runtime, built with Tailwind on the instance
// theme, and a resource from an origin that isn't allowed is blocked by its
// CSP (the page reports the violation itself). Published, it's served from
// the runtime's origin with the same rules; unpublished, the link is gone.
// A workspace folder is saved as a site when it passes the checks.

test.describe.configure({ mode: "serial" });
test.use({ storageState: storageStateFor("ada") });

const APPROVE = /^Approve( all)?$/;
const SAVED_SITE = /Tool result: Saved "Harbour site" as version 1/;
const BLOCKED =
  /Tool result: Not saved: index\.html loads "https:\/\/evil\.example\/x\.png", which is blocked/;
const SEEDED = /Tool result: .*seeded/;
const PUBLISHED_LINK = /\/s\/[\w-]{43}\/$/;

/**
 * The site: a home page whose script reports CSP violations into the page,
 * then reaches for an image on an origin that isn't allowed, built at run
 * time so the save checks (which read markup, not code) don't see it. The
 * CSP still does.
 */
const HOME = [
  "<!doctype html><html><head><title>Harbour</title></head>",
  '<body class="bg-background p-6">',
  '<h1 class="font-bold text-primary">Harbour walks</h1>',
  '<p id="csp">no violation</p>',
  '<a href="about.html">About</a>',
  "<script>document.addEventListener('securitypolicyviolation', (e) => { document.getElementById('csp').textContent = 'blocked ' + new URL(e.blockedURI).host; });",
  "const img = new Image(); img.src = 'https://' + 'evil.example/p.png'; document.body.append(img);</script>",
  "</body></html>",
].join("");
const ABOUT =
  '<!doctype html><html><head></head><body><h1 class="text-muted-foreground">About the walks</h1><a href="index.html">Home</a></body></html>';
const SITE = JSON.stringify({
  files: { "about.html": ABOUT, "index.html": HOME },
  stack: "html-tailwind",
});

const createSite = (title: string, content: string) =>
  `[tool:create_artifact ${JSON.stringify({ content, title, type: "site" })}]`;

const approve = async (page: Page) => {
  const card = page.locator(
    'section[aria-label="Approval needed for create_artifact"]:not([aria-busy="true"])'
  );
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: APPROVE }).click();
};

let chatPath: string;
let publishedUrl: string;

test("a turn is told how to make a site, and a site that loads from a blocked origin isn't saved", async ({
  page,
}) => {
  await page.goto("/");
  // The Site kind's instructions reach the model like a skill's (125).
  await send(page, "[show:system]");
  const reply = await expectReply(page, "A site is a small static website");
  await expect(reply).toContainText("https://fonts.googleapis.com");
  await expect(reply).toContainText("Design guide (html-tailwind)");
  chatPath = `/c/${await conversationIdOf(page)}`;

  await send(
    page,
    createSite(
      "Blocked site",
      JSON.stringify({
        files: {
          "index.html":
            '<!doctype html><html><body><img src="https://evil.example/x.png" alt=""></body></html>',
        },
      })
    )
  );
  await approve(page);
  await expectReply(page, BLOCKED);
});

test("the model makes a site, and it previews built on the theme, with other origins blocked", async ({
  page,
}) => {
  await page.goto(chatPath);
  await send(page, createSite("Harbour site", SITE));
  await approve(page);
  await expectReply(page, SAVED_SITE);

  await page
    .getByRole("button", { name: "Open artifact: Harbour site" })
    .click();
  const panel = page.getByRole("region", { name: "Workspace" });
  const site = panel
    .frameLocator('iframe[title="Preview of Harbour site"]')
    .frameLocator('iframe[title="Harbour site"]');
  const heading = site.getByRole("heading", { name: "Harbour walks" });
  await expect(heading).toBeVisible();
  // Tailwind was compiled for the classes it uses.
  await expect(heading).toHaveCSS("font-weight", "700");
  // The image on another origin never loaded: the CSP blocked it.
  await expect(site.locator("#csp")).toHaveText("blocked evil.example");

  // A link to another of its pages shows that page.
  await site.getByRole("link", { name: "About" }).click();
  await expect(
    panel
      .frameLocator('iframe[title="Preview of Harbour site"]')
      .frameLocator('iframe[title="Harbour site"]')
      .getByRole("heading", { name: "About the walks" })
  ).toBeVisible();
});

test("publishing serves it from the runtime's origin, with the same rules", async ({
  baseURL,
  browser,
  page,
}) => {
  await page.goto("/artifacts");
  const row = page.locator("li[data-artifact-id]").filter({
    has: page.getByRole("link", { exact: true, name: "Harbour site" }),
  });
  await row.getByRole("button", { name: "Actions for Harbour site" }).click();
  await page.getByRole("menuitem", { name: "Publish" }).click();
  const dialog = page.getByRole("dialog", { name: "Publish Harbour site" });
  await dialog.getByRole("button", { exact: true, name: "Publish" }).click();
  const link = dialog.getByRole("textbox", { name: "Public link" });
  await expect(link).toHaveValue(PUBLISHED_LINK);
  publishedUrl = await link.inputValue();
  // On the runtime's origin, never the app's.
  expect(new URL(publishedUrl).origin).not.toBe(new URL(baseURL ?? "").origin);

  // Anyone with the link: a browser with no session.
  const visitor = await browser.newContext({ storageState: undefined });
  const visit = await visitor.newPage();
  const response = await visit.goto(publishedUrl);
  expect(response?.status()).toBe(200);
  const policy = response?.headers()["content-security-policy"] ?? "";
  expect(policy).toContain("https://fonts.googleapis.com");
  expect(policy).toContain("connect-src 'none'");
  expect(policy).not.toContain("evil.example");
  await expect(visit.getByRole("heading", { name: "Harbour walks" })).toHaveCSS(
    "font-weight",
    "700"
  );
  await expect(visit.locator("#csp")).toHaveText("blocked evil.example");
  // Its pages link to each other as files beside it.
  await visit.getByRole("link", { name: "About" }).click();
  await expect(
    visit.getByRole("heading", { name: "About the walks" })
  ).toBeVisible();
  await visitor.close();
});

test("unpublishing takes the link down", async ({ browser, page }) => {
  await page.goto("/artifacts");
  const row = page.locator("li[data-artifact-id]").filter({
    has: page.getByRole("link", { exact: true, name: "Harbour site" }),
  });
  await row.getByRole("button", { name: "Actions for Harbour site" }).click();
  await page.getByRole("menuitem", { name: "Publish" }).click();
  const dialog = page.getByRole("dialog", { name: "Publish Harbour site" });
  await expect(
    dialog.getByRole("textbox", { name: "Public link" })
  ).toHaveValue(publishedUrl);
  await dialog.getByRole("button", { name: "Unpublish" }).click();
  await expect(
    dialog.getByRole("button", { exact: true, name: "Publish" })
  ).toBeVisible();

  const visitor = await browser.newContext({ storageState: undefined });
  const gone = await (await visitor.newPage()).goto(publishedUrl);
  expect(gone?.status()).toBe(404);
  await visitor.close();
});

test("a workspace folder is saved as a site when it passes the checks", async ({
  baseURL,
  page,
}) => {
  await page.goto("/");
  const script = [
    "mkdir -p site/css bad",
    `printf '%s' '<!doctype html><html><head><link rel="stylesheet" href="css/site.css"></head><body><h1 class="text-primary">Built</h1></body></html>' > site/index.html`,
    "printf 'h1 { margin: 0; }' > site/css/site.css",
    `printf '%s' '<!doctype html><html><body><img src="https://evil.example/x.png" alt=""></body></html>' > bad/index.html`,
    "echo seeded",
  ].join(" && ");
  await send(page, `[tool:bash {"command": ${JSON.stringify(script)}}]`);
  await expectReply(page, SEEDED);
  const conversationId = await conversationIdOf(page);

  const panel = await openWorkspace(page);
  const saveAs = async (folder: string, title: string) => {
    await panel.getByRole("button", { name: "Workspace actions" }).click();
    await page.getByRole("menuitem", { name: "Save as site…" }).click();
    const dialog = page.getByRole("dialog", { name: "Save as site" });
    await dialog.getByRole("textbox", { name: "Folder" }).fill(folder);
    await dialog.getByRole("textbox", { name: "Title" }).fill(title);
    await dialog.getByRole("button", { name: "Save as site" }).click();
    return dialog;
  };

  // A folder that loads from a blocked origin isn't saved; the dialog says why.
  const refused = await saveAs("bad", "Bad site");
  await expect(refused.getByRole("alert")).toContainText(
    'index.html loads "https://evil.example/x.png", which is blocked'
  );
  await refused.press("Escape");

  const saved = await saveAs("site", "Built site");
  await expect(saved.getByRole("status")).toContainText('Saved "Built site"');
  await saved.getByRole("button", { name: "Done" }).click();

  const api = await apiFor(page, baseURL ?? "");
  const artifacts = await api.artifacts.list({ conversationId });
  expect(artifacts.map((artifact) => [artifact.kind, artifact.title])).toEqual([
    ["site", "Built site"],
  ]);
  const [built] = artifacts;
  const version = await api.artifacts.getVersion({
    id: built?.id ?? "",
    versionId: built?.latestVersionId ?? "",
  });
  expect(Object.keys(JSON.parse(version.content).files).sort()).toEqual([
    "css/site.css",
    "index.html",
  ]);
});

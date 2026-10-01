import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { expect, type Page, test } from "@playwright/test";
import { linkPreviewSchema } from "@workspace/contract/schemas/link-preview";

import { expectReply, send } from "../support/chat";
import { FIXTURE_ARTICLE, fixtureOrigin } from "../support/fixture-site";
import { storageStateFor } from "../support/users";

// Link previews (101) against the fixture site (support/fixture-site.ts), a
// loopback origin the server may fetch only because serve.ts allowlists it
// with the TEST-ONLY variable. Nothing here reaches the real internet: the
// private and metadata addresses below are refused before any socket opens.
//
// The chat test adds URL citations to the conversation's history as the
// browser receives it: web search isn't wired into runs on main yet (078).
// Everything after that is real: the chip asks our API, the server fetches
// the fixture page through its guards, signs the image addresses, and the
// browser loads them from our image route.

test.use({ storageState: storageStateFor("ben") });

const previewPath = (url: string) =>
  `/api/link-preview?url=${encodeURIComponent(url)}`;

const PREVIEW_IMAGE_PATH = /^\/api\/link-preview\/image\?src=/;
const FIXTURE_NEWS = /Fixture News/;
const LOOPBACK_HOST = /127\.0\.0\.1/;
const CITED = /\/api\/(__batch__|conversations\/[^/]+\/path)/;

test("the server previews a cited page and serves its images, signed", async ({
  page,
}) => {
  const origin = await fixtureOrigin();
  const response = await page.request.get(previewPath(`${origin}/rivers`));
  expect(response.status()).toBe(200);
  const preview = linkPreviewSchema.parse(await response.json());
  expect(preview).toMatchObject({
    description: FIXTURE_ARTICLE.description,
    finalUrl: `${origin}/rivers`,
    siteName: FIXTURE_ARTICLE.siteName,
    title: FIXTURE_ARTICLE.title,
  });
  expect(preview.image?.url).toMatch(PREVIEW_IMAGE_PATH);
  expect(preview.icon).toMatch(PREVIEW_IMAGE_PATH);

  const image = await page.request.get(preview.image?.url ?? "");
  expect(image.status()).toBe(200);
  expect(image.headers()["content-type"]).toBe("image/png");
  expect(image.headers()["x-content-type-options"]).toBe("nosniff");
  expect(image.headers()["content-security-policy"]).toBe(
    "default-src 'none'; sandbox"
  );

  // Not an open proxy: only addresses a preview signed are served.
  const signed = decodeURIComponent(
    new URL(preview.image?.url ?? "", "http://x").searchParams.get("src") ?? ""
  );
  const refused = await Promise.all(
    [
      `${origin}/hero.png`,
      "http://169.254.169.254/latest/meta-data/",
      `${signed}x`,
    ].map((src) =>
      page.request.get(`/api/link-preview/image?src=${encodeURIComponent(src)}`)
    )
  );
  expect(refused.map((r) => r.status())).toEqual([404, 404, 404]);
});

test("the server refuses private destinations and non-pages", async ({
  baseURL,
  page,
}) => {
  const origin = await fixtureOrigin();
  const urls = [
    // Loopback that isn't the allowlisted origin: this very server.
    `${baseURL}/api/config`,
    "http://127.0.0.1/",
    "http://[::1]/",
    "http://169.254.169.254/latest/meta-data/",
    "http://10.0.0.5/",
    // Allowlisted, but not HTML.
    `${origin}/hero.png`,
  ];
  const responses = await Promise.all(
    urls.map((url) => page.request.get(previewPath(url)))
  );
  expect(
    Object.fromEntries(urls.map((url, i) => [url, responses[i]?.status()]))
  ).toEqual(Object.fromEntries(urls.map((url) => [url, 404])));
  const scheme = await page.request.get(previewPath("file:///etc/passwd"));
  expect(scheme.status()).toBe(400);
});

test("previews need a signed-in user", async ({ browser }) => {
  const origin = await fixtureOrigin();
  const signedOut = await browser.newContext({
    storageState: { cookies: [], origins: [] },
  });
  const response = await signedOut.request.get(
    new URL(previewPath(`${origin}/rivers`), test.info().project.use.baseURL)
      .href
  );
  expect(response.status()).toBe(401);
  await signedOut.close();
});

/** Adds URL citations to every assistant message the browser loads. */
const citeFixturePages = async (page: Page, origin: string) => {
  const sources = [
    {
      id: "e2e-source-1",
      source: { kind: "url", title: "Rivers", url: `${origin}/rivers` },
      type: "source",
    },
    {
      id: "e2e-source-2",
      source: { kind: "url", title: "Plain notes", url: `${origin}/notes` },
      type: "source",
    },
  ];
  const cite = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      return value.map(cite);
    }
    if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      if (record.role === "assistant" && Array.isArray(record.parts)) {
        return { ...record, parts: [...record.parts, ...sources] };
      }
      return Object.fromEntries(
        Object.entries(record).map(([key, entry]) => [key, cite(entry)])
      );
    }
    return value;
  };
  await page.route(CITED, async (route) => {
    const response = await route.fetch();
    const text = await response.text();
    let body = text;
    try {
      body = JSON.stringify(cite(JSON.parse(text)));
    } catch {
      // Not JSON: pass it through.
    }
    await route.fulfill({ body, response });
  });
};

const SCREENS = process.env.LINK_PREVIEW_SCREENSHOTS;

test("a source chip shows the favicon and opens a preview card", async ({
  page,
}) => {
  const origin = await fixtureOrigin();
  await page.goto("/");
  await send(page, "Rivers and temperature");
  await expectReply(page, "Echo: Rivers and temperature");

  await citeFixturePages(page, origin);
  await page.reload();
  const sources = page.getByRole("region", { name: "Sources" }).last();
  const rivers = sources.getByRole("link", { name: FIXTURE_NEWS });
  await expect(rivers).toBeVisible({ timeout: 30_000 });

  // The favicon loaded from our image route; the page without one shows a letter.
  const favicon = rivers.locator("img[data-slot=favicon]");
  await expect
    .poll(() => favicon.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0);
  expect(await favicon.getAttribute("src")).toMatch(PREVIEW_IMAGE_PATH);
  const notes = sources.getByRole("link", { name: LOOPBACK_HOST });
  await expect(notes.locator("span[data-slot=favicon]")).toHaveText("1");

  expect(await rivers.getAttribute("target")).toBe("_blank");
  expect(await rivers.getAttribute("rel")).toBe("noopener noreferrer");

  await rivers.hover();
  const card = page.locator("[data-slot=link-preview-card]");
  await expect(card).toBeVisible();
  await expect(card).toContainText(FIXTURE_ARTICLE.title);
  await expect(card).toContainText(FIXTURE_ARTICLE.description);
  await expect(card).toContainText(FIXTURE_ARTICLE.siteName);
  const image = card.locator("img[alt='A river at dawn']");
  await expect
    .poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0);
  const open = card.getByRole("link", { name: "Open" });
  expect(await open.getAttribute("href")).toBe(`${origin}/rivers`);
  expect(await open.getAttribute("rel")).toBe("noopener noreferrer");

  if (SCREENS) {
    await mkdir(SCREENS, { recursive: true });
    for (const scheme of ["light", "dark"] as const) {
      for (const [name, size] of [
        ["desktop", { height: 900, width: 1280 }],
        ["375", { height: 812, width: 375 }],
      ] as const) {
        // biome-ignore lint/performance/noAwaitInLoops: one screen at a time
        await page.setViewportSize(size);
        await page.emulateMedia({ colorScheme: scheme });
        await page.evaluate((theme) => {
          localStorage.setItem("theme", theme);
          document.documentElement.classList.toggle("dark", theme === "dark");
          document.documentElement.style.colorScheme = theme;
        }, scheme);
        await page.mouse.move(0, 0);
        await expect(card).toBeHidden();
        await rivers.scrollIntoViewIfNeeded();
        await rivers.hover();
        await expect(card).toBeVisible();
        await expect
          .poll(() =>
            image.evaluate((img: HTMLImageElement) => img.naturalWidth)
          )
          .toBeGreaterThan(0);
        await page.screenshot({
          path: join(SCREENS, `sources-${scheme}-${name}.png`),
        });
      }
    }
    // The page without an image: the blurred favicon fallback.
    await page.mouse.move(0, 0);
    await expect(card).toBeHidden();
    await notes.hover();
    await expect(card).toContainText("Plain notes");
    await page.screenshot({
      path: join(SCREENS, "sources-no-image-dark-375.png"),
    });
  }
});

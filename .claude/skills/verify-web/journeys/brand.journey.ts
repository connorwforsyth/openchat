import { join } from "node:path";
import { type APIRequestContext, expect, type Page } from "@playwright/test";
import { BRAND_NAME } from "../../../../e2e/support/brand";

import { proof } from "./evidence";
import { test } from "./fixtures";

// Feature: brand assets (features/brand.md). The instance's logo is
// brand/logo.svg, a `currentColor` mark: it takes the theme's text colour in
// the app, the tab icon switches with the OS scheme, and home-screen icons
// are PNG tiles at their declared sizes.

const proofPath = (file: string) =>
  join(process.env.VERIFY_RUN_DIR ?? "", "evidence", "brand", file);

const DARK = /\bdark\b/;
const SCHEME_SWITCH = "@media (prefers-color-scheme:dark){svg{color:white}}";

const pngSize = async (request: APIRequestContext, path: string) => {
  const response = await request.get(path);
  expect(response.headers()["content-type"]).toBe("image/png");
  const bytes = await response.body();
  return { height: bytes.readUInt32BE(20), width: bytes.readUInt32BE(16) };
};

/** The visible logo's ink colour and the name's text colour beside it. */
const logoColours = (page: Page, scope: string) =>
  page.evaluate((selector) => {
    const root = document.querySelector(selector);
    const layers = [...(root?.querySelectorAll("span.relative") ?? [])].find(
      (each) => (each as HTMLElement).offsetParent !== null
    );
    const ink = layers?.querySelector("span[aria-hidden]");
    const image = layers?.querySelector("img");
    return {
      ink: ink ? getComputedStyle(ink).backgroundColor : null,
      loaded: image ? image.complete && image.naturalWidth > 0 : false,
      paint: image?.getAttribute("src") ?? null,
      text: root ? getComputedStyle(root).color : null,
    };
  }, scope);

/** Whether the ink layer draws the mark: hiding it changes the pixels. */
const inkDraws = async (page: Page): Promise<boolean> => {
  const layers = page.locator("main > div span.relative:visible").first();
  const clip = await layers.boundingBox();
  if (!clip) {
    return false;
  }
  const shown = await page.screenshot({ clip });
  await layers
    .locator("span[aria-hidden]")
    .evaluate((ink) => ink.setAttribute("style", "visibility:hidden"));
  const hidden = await page.screenshot({ clip });
  return !shown.equals(hidden);
};

test("sign-in shows the logo in the theme's colour, light and dark", async ({
  page,
}) => {
  const seen: Record<string, unknown> = {};
  for (const scheme of ["light", "dark"] as const) {
    // biome-ignore lint/performance/noAwaitInLoops: one scheme, then the other.
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/sign-in");
    await expect(page.getByText(BRAND_NAME, { exact: true })).toBeVisible();
    const colours = await logoColours(page, "main > div");
    expect(colours.loaded).toBe(true);
    expect(colours.ink).toBe(colours.text);
    seen[scheme] = colours;
    await proof(page, "brand", `01-sign-in-${scheme}`, colours);
    expect(await inkDraws(page)).toBe(true);
  }
  expect((seen.light as { ink: string }).ink).not.toBe(
    (seen.dark as { ink: string }).ink
  );
});

test("the head links an SVG tab icon, a PNG fallback and an Apple icon", async ({
  page,
  request,
}) => {
  await page.goto("/sign-in");
  const links = await page.evaluate(() =>
    [
      ...document.head.querySelectorAll(
        "link[rel~=icon], link[rel=apple-touch-icon], link[rel=manifest]"
      ),
    ].map((link) => ({
      href: link.getAttribute("href"),
      rel: link.getAttribute("rel"),
      sizes: link.getAttribute("sizes"),
      type: link.getAttribute("type"),
    }))
  );
  expect(links).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        href: "/brand/icon.svg",
        type: "image/svg+xml",
      }),
      expect.objectContaining({ href: "/brand/icon-32.png", sizes: "32x32" }),
      expect.objectContaining({
        href: "/brand/apple-icon.png",
        rel: "apple-touch-icon",
      }),
      expect.objectContaining({ rel: "manifest" }),
    ])
  );

  const icon = await request.get("/brand/icon.svg");
  expect(icon.headers()["content-type"]).toBe("image/svg+xml");
  expect(await icon.text()).toContain(SCHEME_SWITCH);

  const manifestHref = links.find((link) => link.rel === "manifest")?.href;
  const manifest = await (await request.get(manifestHref ?? "")).json();
  expect(manifest.name).toBe(BRAND_NAME);
  const sizes: Record<string, unknown> = {};
  for (const entry of manifest.icons) {
    // biome-ignore lint/performance/noAwaitInLoops: a few small reads.
    const size = await pngSize(request, entry.src);
    expect(`${size.width}x${size.height}`).toBe(entry.sizes);
    sizes[entry.src] = size;
  }
  expect(
    manifest.icons.map((entry: { purpose: string }) => entry.purpose)
  ).toContain("maskable");
  const apple = await pngSize(request, "/brand/apple-icon.png");
  expect(apple).toEqual({ height: 180, width: 180 });

  // The tab icon on each scheme's background, beside the PNG tiles.
  const { origin } = new URL(page.url());
  // A same-origin page without React, so none runs under the new content.
  await page.goto(manifestHref ?? "");
  const images = [
    "icon.svg",
    "icon-32.png",
    "apple-icon.png",
    "icon-maskable-512.png",
  ]
    .map(
      (name) => `<img src="${origin}/brand/${name}" width="128" height="128">`
    )
    .join("");
  for (const scheme of ["light", "dark"] as const) {
    // biome-ignore lint/performance/noAwaitInLoops: one scheme, then the other.
    await page.emulateMedia({ colorScheme: scheme });
    await page.setContent(
      `<body style="color-scheme:light dark;background:Canvas;margin:0;display:flex;gap:24px;padding:24px">${images}</body>`
    );
    await page.waitForFunction(() =>
      [...document.images].every(
        (image) => image.complete && image.naturalWidth > 0
      )
    );
    await page.screenshot({ path: proofPath(`02-icons-${scheme}.png`) });
  }
  await proof(page, "brand", "02-head-and-manifest", {
    apple,
    links,
    manifest,
    sizes,
  });
});

test("the logo follows the app's theme over the OS's", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.addInitScript(() => localStorage.setItem("theme", "dark"));
  await page.goto("/sign-in");
  await expect(page.locator("html")).toHaveClass(DARK);
  const colours = await logoColours(page, "main > div");
  expect(colours).toMatchObject({ loaded: true, paint: "/brand/logo-dark" });
  expect(colours.ink).toBe(colours.text);
  await proof(page, "brand", "03-app-dark-on-light-os", colours);
  expect(await inkDraws(page)).toBe(true);
});

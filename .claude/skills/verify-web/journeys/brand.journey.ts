import { join } from "node:path";

import { type APIRequestContext, expect, type Page } from "@playwright/test";
import { BRAND_NAME } from "../../../../e2e/support/brand";
import { proof } from "./evidence";
import { test } from "./fixtures";

// Feature: brand assets (features/brand.md). The instance's logo is
// brand/logo.svg, one colour, drawn as a mask in the theme's text colour. Its
// dark logo is e2e/support/brand/badge.svg, a currentColor square on a red
// badge, drawn as it is. Its favicon has no viewBox, which next/og can't draw,
// so the PNG tiles fall back to the placeholder mark.

const proofPath = (file: string) =>
  join(process.env.VERIFY_RUN_DIR ?? "", "evidence", "brand", file);

const DARK = /\bdark\b/;

const pngSize = async (request: APIRequestContext, path: string) => {
  const response = await request.get(path);
  expect(response.headers()["content-type"]).toBe("image/png");
  const bytes = await response.body();
  return { height: bytes.readUInt32BE(20), width: bytes.readUInt32BE(16) };
};

/** The visible logo on sign-in: how it's drawn and the colours involved. */
const visibleLogo = (page: Page) =>
  page.evaluate(() => {
    const box = document.querySelector("main > div");
    const marks = [...(box?.querySelectorAll("span.bg-current, img") ?? [])];
    const shown = marks.find(
      (each) =>
        (each as HTMLElement).offsetParent !== null &&
        getComputedStyle(each).visibility !== "hidden"
    );
    if (!shown) {
      return null;
    }
    const image =
      shown instanceof HTMLImageElement ? shown : shown.querySelector("img");
    return {
      fill: getComputedStyle(shown).backgroundColor,
      loaded: image ? image.complete && image.naturalWidth > 0 : false,
      mode: shown instanceof HTMLImageElement ? "image" : "mask",
      src: image?.getAttribute("src") ?? null,
      text: box ? getComputedStyle(box).color : null,
    };
  });

/** Whether the mask draws the mark: clearing its fill changes the pixels. */
const maskDraws = async (page: Page): Promise<boolean> => {
  const mark = page.locator("main > div span.bg-current:visible").first();
  const clip = await mark.boundingBox();
  if (!clip) {
    return false;
  }
  const shown = await page.screenshot({ clip });
  await mark.evaluate((each) => {
    (each as HTMLElement).style.backgroundColor = "transparent";
  });
  const cleared = await page.screenshot({ clip });
  return !shown.equals(cleared);
};

/** The badge logo's centre and corner pixels, read from the loaded image. */
const badgePixels = (page: Page) =>
  page.evaluate(() => {
    const image = [...document.querySelectorAll("main > div img")].find(
      (each) => (each as HTMLElement).offsetParent !== null
    ) as HTMLImageElement | undefined;
    if (!image) {
      return null;
    }
    const canvas = document.createElement("canvas");
    canvas.width = 24;
    canvas.height = 24;
    const context = canvas.getContext("2d");
    context?.drawImage(image, 0, 0, 24, 24);
    const at = (x: number, y: number) => [
      ...(context?.getImageData(x, y, 1, 1).data ?? []),
    ];
    return { centre: at(12, 12), edge: at(3, 12) };
  });

test("one-colour logo on light, the multi-colour dark logo on dark", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/sign-in");
  await expect(page.getByText(BRAND_NAME, { exact: true })).toBeVisible();
  const light = await visibleLogo(page);
  expect(light).toMatchObject({
    loaded: true,
    mode: "mask",
    src: "/brand/logo",
  });
  expect(light?.fill).toBe(light?.text);
  await proof(page, "brand", "01-sign-in-light", light);
  expect(await maskDraws(page)).toBe(true);

  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/sign-in");
  await expect(page.locator("html")).toHaveClass(DARK);
  const dark = await visibleLogo(page);
  expect(dark).toMatchObject({
    loaded: true,
    mode: "image",
    src: "/brand/logo-dark",
  });
  // The currentColor square stays on top of the red badge: dark, not red.
  const pixels = await badgePixels(page);
  const [red = 0, green = 0, blue = 0, alpha = 0] = pixels?.centre ?? [];
  expect(alpha).toBe(255);
  expect(Math.max(red, green, blue)).toBeLessThan(64);
  const [edgeRed = 0, edgeGreen = 255] = pixels?.edge ?? [];
  expect(edgeRed).toBeGreaterThan(180);
  expect(edgeGreen).toBeLessThan(80);
  await proof(page, "brand", "02-sign-in-dark", { ...dark, pixels });
});

test("the app's dark theme wins over a light OS", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.addInitScript(() => localStorage.setItem("theme", "dark"));
  await page.goto("/sign-in");
  await expect(page.locator("html")).toHaveClass(DARK);
  const logo = await visibleLogo(page);
  expect(logo).toMatchObject({ loaded: true, src: "/brand/logo-dark" });
  await proof(page, "brand", "03-app-dark-on-light-os", logo);
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
  const iconText = await icon.text();
  expect(iconText).toContain("<image href=");
  // The favicon is one colour, so the tab icon inverts on dark tab strips.
  expect(iconText).toContain("@media (prefers-color-scheme:dark)");

  const manifestHref = links.find((link) => link.rel === "manifest")?.href;
  const manifest = await (await request.get(manifestHref ?? "")).json();
  expect(manifest.name).toBe(BRAND_NAME);
  const sizes: Record<string, unknown> = {};
  // The favicon can't be drawn, so every tile is the placeholder, never a 500.
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
  const favicon = await pngSize(request, "/favicon.ico");
  expect(favicon).toEqual({ height: 32, width: 32 });

  await proof(page, "brand", "04-head-and-manifest", {
    apple,
    favicon,
    links,
    manifest,
    sizes,
  });

  // The icons drawn at 128px on each scheme's background, from a page
  // without React so nothing runs under the new content.
  const { origin } = new URL(page.url());
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
    await page.screenshot({ path: proofPath(`04-icons-${scheme}.png`) });
  }
});

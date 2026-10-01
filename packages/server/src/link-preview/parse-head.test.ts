import { describe, expect, it } from "vitest";

import { LATIN1, MESSY, OG_FULL, PLAIN, TWITTER_ONLY } from "./fixture-pages";
import { decodeHtml, parseHead } from "./parse-head";

// The `<head>` parser (101) over fixture pages.

const PAGES = {
  "latin1.html": LATIN1,
  "messy.html": MESSY,
  "og-full.html": OG_FULL,
  "plain.html": PLAIN,
  "twitter-only.html": TWITTER_ONLY,
} as const;

const parse = (
  name: keyof typeof PAGES,
  url: string,
  charset: string | null = null
) => {
  const page = PAGES[name];
  const bytes =
    typeof page === "string" ? new TextEncoder().encode(page) : page;
  return parseHead(decodeHtml(bytes, charset), new URL(url));
};

describe("parseHead", () => {
  it("prefers og:* tags, and picks the smallest raster icon of at least 32px", () => {
    expect(parse("og-full.html", "https://news.example.test/rivers")).toEqual({
      description:
        "A study of 300 rivers finds water temperatures rising faster than the air above them.",
      icon: "https://news.example.test/favicon-32.png",
      image: {
        alt: "A river at dawn",
        height: 630,
        url: "https://cdn.example.test/rivers/hero.jpg",
        width: 1200,
      },
      siteName: "Example News",
      title: "Rivers are getting warmer",
    });
  });

  it("falls back to twitter:* tags, case-insensitively, resolving relative URLs", () => {
    expect(
      parse("twitter-only.html", "https://docs.example.test/start/")
    ).toEqual({
      description: "Install the CLI, then run it.",
      icon: "https://docs.example.test/touch.png",
      image: {
        alt: "The CLI in a terminal",
        url: "https://docs.example.test/img/card.png",
      },
      title: "Getting started",
    });
  });

  it("falls back to <title>, the description meta and /favicon.ico", () => {
    expect(parse("plain.html", "http://plain.example.test/a/b?c=d")).toEqual({
      description: "Nothing but the basics.",
      icon: "http://plain.example.test/favicon.ico",
      title: "A plain page",
    });
  });

  it("ignores comments, scripts and styles; decodes entities; strips markup; honours <base>", () => {
    expect(parse("messy.html", "https://messy.example.test/post")).toEqual({
      description: "Bold claims and markup stripped",
      icon: "https://static.example.test/assets/favicon.ico",
      image: { url: "https://static.example.test/assets/images/card.webp" },
      title: 'Tom & Jerry\'s "Guide" — ☺',
    });
  });

  it("decodes the charset the page declares", () => {
    expect(parse("latin1.html", "https://cafe.example.test/").title).toBe(
      "Café crème"
    );
  });

  it("caps text lengths", () => {
    const html = `<head><title>${"t".repeat(1000)}</title><meta name="description" content="${"d ".repeat(1000)}"></head>`;
    const parsed = parseHead(html, new URL("https://x.example.test/"));
    expect(parsed.title?.length).toBeLessThanOrEqual(300);
    expect(parsed.title?.endsWith("…")).toBe(true);
    expect(parsed.description?.length).toBeLessThanOrEqual(500);
  });

  it("caps by UTF-16 length without splitting a surrogate pair", () => {
    const html = `<head><title>${"😀".repeat(400)}</title></head>`;
    const { title } = parseHead(html, new URL("https://x.example.test/"));
    expect(title?.length).toBeLessThanOrEqual(300);
    expect(title?.endsWith("😀…")).toBe(true);
  });

  it("drops image URLs too long to sign", () => {
    const html = `<head><meta property="og:image" content="/${"a".repeat(3000)}.png"></head>`;
    expect(
      parseHead(html, new URL("https://x.example.test/")).image
    ).toBeUndefined();
  });

  it("drops images and icons that aren't http(s)", () => {
    const html = `<head>
      <meta property="og:image" content="data:image/png;base64,AAAA">
      <link rel="icon" href="file:///etc/passwd">
    </head>`;
    expect(parseHead(html, new URL("https://x.example.test/"))).toEqual({
      icon: "https://x.example.test/favicon.ico",
    });
  });

  it("stops at the body, even with no </head>", () => {
    const html =
      "<title>Head</title><body><meta property='og:title' content='Body'>";
    expect(parseHead(html, new URL("https://x.example.test/")).title).toBe(
      "Head"
    );
  });

  it("survives an unterminated tag or attribute", () => {
    const html = `<head><title>Ok</title><meta property="og:description content="x`;
    expect(parseHead(html, new URL("https://x.example.test/")).title).toBe(
      "Ok"
    );
  });
});

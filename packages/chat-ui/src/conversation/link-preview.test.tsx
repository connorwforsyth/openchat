import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import type { LinkPreview } from "@workspace/contract/schemas/link-preview";
import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import { renderWithI18n } from "../testing/render";
import {
  createHttpLinkPreviewLoader,
  type LinkPreviewLoader,
  LinkPreviewProvider,
  UrlSourceChip,
} from "./link-preview";
import { Sources } from "./sources";

// Source chips with favicons and preview cards (101), over a fake loader:
// the HTTP loader is tested on its own with a fake fetch.

afterEach(cleanup);

// A 1×1 PNG, so <img> really loads in the browser.
const PIXEL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

const URL_A = "https://news.example.test/rivers";

const preview = (overrides: Partial<LinkPreview> = {}): LinkPreview => ({
  description: "A study of 300 rivers finds water warming faster than air.",
  fetchedAt: "2026-10-01T09:00:00.000Z",
  finalUrl: URL_A,
  icon: PIXEL,
  image: { alt: "A river at dawn", url: PIXEL },
  siteName: "Example News",
  title: "Rivers are getting warmer",
  url: URL_A,
  ...overrides,
});

const ready =
  (value: LinkPreview = preview()): LinkPreviewLoader =>
  () =>
    Promise.resolve({ preview: value, status: "ready" });

const renderChip = (load: LinkPreviewLoader, url = URL_A) =>
  renderWithI18n(
    <LinkPreviewProvider load={load}>
      <UrlSourceChip number={1} title="Rivers" url={url} />
    </LinkPreviewProvider>
  );

const CHIP_NAME = /Example News|news/;
const FAR = /far\.example\.test/;

const chip = () => screen.getByRole("link", { name: CHIP_NAME });

// Tests share one pointer. A chip that mounts under where the last test left
// it gets its mouseenter before the hover card listens, and hovering it again
// is only a move, which the card ignores. Moving off first makes the hover a
// real enter.
const hoverChip = async () => {
  await userEvent.unhover(chip());
  await userEvent.hover(chip());
};

describe("UrlSourceChip", () => {
  it("shows a letter while loading, then the favicon and site name", async () => {
    let resolve: (value: Awaited<ReturnType<LinkPreviewLoader>>) => void = () =>
      undefined;
    const load = vi.fn<LinkPreviewLoader>(
      () =>
        new Promise((done) => {
          resolve = done;
        })
    );
    const { container } = renderChip(load);
    await waitFor(() => expect(load).toHaveBeenCalled());
    const letter = container.querySelector("[data-slot=favicon]");
    expect(letter?.tagName).toBe("SPAN");
    expect(letter?.textContent).toBe("N");
    expect(chip().textContent).toContain("news.example.test");
    resolve({ preview: preview(), status: "ready" });
    await screen.findByText("Example News");
    await waitFor(() =>
      expect(container.querySelector("img[data-slot=favicon]")).not.toBeNull()
    );
  });

  it("falls back to the letter when the favicon doesn't load", async () => {
    const { container } = renderChip(
      ready(preview({ icon: "/api/link-preview/image?src=missing" }))
    );
    await screen.findByText("Example News");
    await waitFor(() =>
      expect(container.querySelector("[data-slot=favicon]")?.tagName).toBe(
        "SPAN"
      )
    );
  });

  it("shows the host and no favicon or card when previews are off", async () => {
    const { container } = renderChip(() => Promise.resolve({ status: "off" }));
    await waitFor(() =>
      expect(container.querySelector("[data-preview=off]")).not.toBeNull()
    );
    expect(container.querySelector("[data-slot=favicon]")).toBeNull();
    expect(chip().textContent).toContain("news.example.test");
    await hoverChip();
    await new Promise((done) => setTimeout(done, 500));
    expect(document.querySelector("[data-slot=link-preview-card]")).toBeNull();
  });

  it("opens the card on hover, with image, site, title, description, host and Open", async () => {
    renderChip(ready());
    await screen.findByText("Example News");
    await hoverChip();
    const card = await waitFor(() => {
      const found = document.querySelector("[data-slot=link-preview-card]");
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    expect(card.textContent).toContain("Rivers are getting warmer");
    expect(card.textContent).toContain("water warming faster");
    expect(card.textContent).toContain("news.example.test");
    await waitFor(() =>
      expect(card.querySelector("img[alt='A river at dawn']")).not.toBeNull()
    );
    const open = screen.getByRole("link", { name: "Open" });
    expect(open.getAttribute("href")).toBe(URL_A);
    expect(open.getAttribute("target")).toBe("_blank");
    expect(open.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("opens the card on keyboard focus", async () => {
    renderChip(ready());
    await screen.findByText("Example News");
    await userEvent.keyboard("{Tab}");
    expect(document.activeElement).toBe(chip());
    await waitFor(() =>
      expect(
        document.querySelector("[data-slot=link-preview-card]")
      ).not.toBeNull()
    );
  });

  it("shows a blurred fallback when the page has no image", async () => {
    renderChip(ready(preview({ image: undefined })));
    await screen.findByText("Example News");
    await hoverChip();
    await waitFor(() =>
      expect(document.querySelector("[data-fallback]")).not.toBeNull()
    );
  });

  it("opens the card on a tap instead of leaving the page", async () => {
    renderChip(ready());
    await screen.findByText("Example News");
    const link = chip();
    fireEvent.pointerDown(link, { pointerType: "touch" });
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    link.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    await waitFor(() =>
      expect(
        document.querySelector("[data-slot=link-preview-card]")
      ).not.toBeNull()
    );
    expect(screen.getByRole("link", { name: "Open" })).toBeTruthy();
  });

  it("opens the page in a new tab, safely", async () => {
    renderChip(ready());
    await screen.findByText("Example News");
    expect(chip().getAttribute("target")).toBe("_blank");
    expect(chip().getAttribute("rel")).toBe("noopener noreferrer");
    expect(chip().getAttribute("href")).toBe(URL_A);
  });

  it("loads a preview only when its chip nears the viewport", async () => {
    const load = vi.fn(ready());
    renderWithI18n(
      <LinkPreviewProvider load={load}>
        <div style={{ height: 4000 }} />
        <UrlSourceChip number={1} title="Far" url="https://far.example.test/" />
      </LinkPreviewProvider>
    );
    await new Promise((done) => setTimeout(done, 300));
    expect(load).not.toHaveBeenCalled();
    screen.getByRole("link", { name: FAR }).scrollIntoView();
    await waitFor(() =>
      expect(load).toHaveBeenCalledWith("https://far.example.test/")
    );
  });
});

describe("Sources", () => {
  it("renders URL sources as preview chips beside file sources", async () => {
    renderWithI18n(
      <LinkPreviewProvider load={ready()}>
        <Sources
          sources={[
            {
              id: "s1",
              source: { kind: "url", title: "Rivers", url: URL_A },
              type: "source",
            },
          ]}
        />
      </LinkPreviewProvider>
    );
    expect(await screen.findByText("Example News")).toBeTruthy();
  });
});

describe("createHttpLinkPreviewLoader", () => {
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      headers: { "content-type": "application/json" },
      status,
    });

  it("asks our API once per URL and parses the contract", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(
        json(
          200,
          preview({
            icon: "/api/link-preview/image?src=i",
            image: { url: "/api/link-preview/image?src=m" },
          })
        )
      )
    );
    const load = createHttpLinkPreviewLoader({ fetch });
    const [first, second] = await Promise.all([load(URL_A), load(URL_A)]);
    expect(first).toEqual(second);
    expect(first.status).toBe("ready");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[0]).toBe(
      `/api/link-preview?url=${encodeURIComponent(URL_A)}`
    );
  });

  it("refuses a preview whose images point off our origin", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(json(200, preview({ icon: "https://evil.test/i.png" })))
    );
    expect(await createHttpLinkPreviewLoader({ fetch })(URL_A)).toEqual({
      status: "none",
    });
  });

  it("stops asking once the server says previews are off", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(json(403, { code: "FEATURE_DISABLED" }))
    );
    const load = createHttpLinkPreviewLoader({ fetch });
    expect(await load("https://a.example.test/")).toEqual({ status: "off" });
    expect(await load("https://b.example.test/")).toEqual({ status: "off" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("treats NOT_FOUND as no preview, and retries a rate limit later", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(json(404, { code: "NOT_FOUND" }))
      .mockResolvedValueOnce(json(429, { code: "RATE_LIMITED" }))
      .mockResolvedValueOnce(
        json(200, preview({ icon: undefined, image: undefined }))
      );
    const load = createHttpLinkPreviewLoader({ fetch });
    expect(await load("https://gone.example.test/")).toEqual({
      status: "none",
    });
    expect(await load("https://gone.example.test/")).toEqual({
      status: "none",
    });
    expect(await load(URL_A)).toEqual({ status: "none" });
    expect((await load(URL_A)).status).toBe("ready");
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});

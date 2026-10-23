import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { regionRasterizer, slidePicture } from "./slide-raster";

const { toCanvas } = vi.hoisted(() => ({ toCanvas: vi.fn() }));
vi.mock("html-to-image", () => ({ toCanvas }));

const context = {
  drawImage: vi.fn(),
  fillRect: vi.fn(),
  fillStyle: "",
};
const page = {
  getContext: vi.fn(() => context),
  height: 0,
  toDataURL: vi.fn(() => "data:image/jpeg;base64,page"),
  width: 0,
};
const style = { remove: vi.fn(), textContent: "" };
const host = {
  classList: { add: vi.fn(), remove: vi.fn() },
  removeAttribute: vi.fn(),
  setAttribute: vi.fn(),
};
const drawn = {
  getContext: vi.fn(() => null),
  height: 2160,
  toDataURL: vi.fn(() => "data:image/jpeg;base64/unflattened"),
  width: 3840,
};
const theme = vi.fn(() => "ivory");

beforeEach(() => {
  vi.clearAllMocks();
  toCanvas.mockReset().mockResolvedValue(drawn);
  theme.mockReturnValue("ivory");
  vi.stubGlobal(
    "getComputedStyle",
    vi.fn(() => ({ getPropertyValue: theme }))
  );
  vi.stubGlobal("document", {
    createElement: (tag: string) => {
      if (tag === "canvas") {
        return page;
      }
      return tag === "style" ? style : host;
    },
    head: { append: vi.fn() },
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("slide pictures", () => {
  it("flattens the page over its scoped theme background before JPEG encoding", async () => {
    const element = document.createElement("div");
    await expect(slidePicture(element)).resolves.toBe(
      "data:image/jpeg;base64,page"
    );
    expect(getComputedStyle).toHaveBeenCalledWith(element);
    expect(theme).toHaveBeenCalledWith("--background");
    expect(context.fillStyle).toBe("ivory");
    expect(page.width).toBe(3840);
    expect(page.height).toBe(2160);
    expect(context.fillRect).toHaveBeenCalledWith(0, 0, 3840, 2160);
    expect(context.drawImage).toHaveBeenCalledWith(drawn, 0, 0);
    expect(context.fillRect.mock.invocationCallOrder[0]).toBeLessThan(
      context.drawImage.mock.invocationCallOrder[0] ?? 0
    );
    expect(page.toDataURL).toHaveBeenCalledWith("image/jpeg", 0.95);
    expect(drawn.toDataURL).not.toHaveBeenCalled();
  });

  it("uses paper white when the theme has no background token", async () => {
    theme.mockReturnValue("");
    await slidePicture(document.createElement("div"));
    expect(context.fillStyle).toBe("white");
  });
});

describe("region pictures", () => {
  it("omits a region when drawing fails and removes all isolation state", async () => {
    toCanvas.mockRejectedValueOnce(new Error("undrawable image"));
    const element = document.createElement("div");
    const rasterize = regionRasterizer(element);
    const region = { h: 20, w: 30, x: 0, y: 0 };
    await expect(rasterize(element, region)).resolves.toBeNull();
    expect(host.removeAttribute).toHaveBeenCalledWith(
      "data-deck-raster-target"
    );
    expect(host.classList.remove).toHaveBeenCalledWith("deck-raster-isolate");
    expect(style.remove).toHaveBeenCalledOnce();
    await expect(rasterize(element, region)).resolves.toBeNull();
    expect(toCanvas).toHaveBeenCalledTimes(2);
  });

  it("does not flatten region pictures over the page background", async () => {
    const element = document.createElement("div");
    await regionRasterizer(element)(element, { h: 20, w: 30, x: 0, y: 0 });
    expect(getComputedStyle).not.toHaveBeenCalled();
    expect(context.fillRect).not.toHaveBeenCalled();
  });
});

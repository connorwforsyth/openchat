import { describe, expect, it } from "vitest";

import type { LayoutColor } from "./slide-layout";
import {
  chartItemOf,
  failedSlideLayout,
  opaqueBounds,
  type RasterFacts,
  rasterReason,
  regionOf,
} from "./slide-rules";

const plain: RasterFacts = {
  backdropFilter: "none",
  backgroundImage: "none",
  boxShadow: "none",
  clipPath: "none",
  filter: "none",
  maskImage: "none",
  tag: "DIV",
  transform: "none",
};

const ink: LayoutColor = { a: 1, b: 20, g: 20, r: 20 };
const box = { h: 100, w: 200, x: 10, y: 20 };

describe("rasterReason", () => {
  it("maps plain boxes natively", () => {
    expect(rasterReason(plain)).toBeNull();
    expect(rasterReason({ ...plain, tag: "IMG" })).toBeNull();
  });

  it("names what PowerPoint can't draw natively", () => {
    expect(
      rasterReason({
        ...plain,
        backgroundImage: "linear-gradient(red, blue)",
      })
    ).toBe("backgroundImage");
    expect(
      rasterReason({
        ...plain,
        transform: "matrix(0.97, 0.2, -0.2, 0.97, 0, 0)",
      })
    ).toBe("transform");
    expect(rasterReason({ ...plain, boxShadow: "0 4px 8px black" })).toBe(
      "boxShadow"
    );
    expect(rasterReason({ ...plain, tag: "svg" })).toBe("svg");
    expect(rasterReason({ ...plain, tag: "CANVAS" })).toBe("canvas");
  });
});

describe("regionOf", () => {
  it("grows a box by its bleed and keeps it on the canvas", () => {
    expect(regionOf({ h: 100.4, w: 200.2, x: 10.5, y: 20 }, 0)).toEqual({
      h: 101,
      w: 201,
      x: 10,
      y: 20,
    });
    expect(regionOf({ h: 100, w: 100, x: 1850, y: -10 }, 96)).toEqual({
      h: 186,
      w: 166,
      x: 1754,
      y: 0,
    });
  });
});

describe("opaqueBounds", () => {
  const pixels = (
    width: number,
    height: number,
    painted: [number, number][]
  ) => {
    const data = new Uint8ClampedArray(width * height * 4);
    for (const [x, y] of painted) {
      data[(y * width + x) * 4 + 3] = 255;
    }
    return data;
  };

  it("hugs the painted pixels", () => {
    expect(
      opaqueBounds(
        pixels(6, 4, [
          [1, 1],
          [4, 2],
        ]),
        6,
        4
      )
    ).toEqual({ h: 2, w: 4, x: 1, y: 1 });
  });

  it("is null when nothing is painted", () => {
    expect(opaqueBounds(pixels(3, 3, []), 3, 3)).toBeNull();
  });
});

describe("chartItemOf", () => {
  const look = { colors: [ink], fontSize: 28, labelColor: ink };

  it("reads slide-ui's chart data", () => {
    const chart = {
      labels: ["A", "B"],
      series: [{ name: "S", values: [1, 2] }],
      type: "line",
    };
    expect(chartItemOf(JSON.stringify(chart), box, look)).toEqual({
      ok: true,
      value: { ...box, ...look, chart, colors: [ink], type: "chart" },
    });
  });

  it("says why data isn't a chart, so the figure becomes a picture", () => {
    expect(chartItemOf("{", box, look).ok).toBe(false);
    expect(
      chartItemOf(
        JSON.stringify({ labels: [], series: [], type: "donut" }),
        box,
        look
      ).ok
    ).toBe(false);
    expect(
      chartItemOf(
        JSON.stringify({ labels: [], series: [], type: "bar" }),
        box,
        { ...look, colors: [] }
      ).ok
    ).toBe(false);
  });
});

describe("failedSlideLayout", () => {
  it("says which slide failed and why, keeping its notes", () => {
    const layout = failedSlideLayout(
      { id: "broken", message: "boom", notes: "Say sorry.", number: 3 },
      { background: null, foreground: ink, muted: ink }
    );
    expect(
      layout.items.map((item) => item.type === "text" && item.text)
    ).toEqual(["3 · broken", "boom"]);
    expect(layout).toMatchObject({ notes: "Say sorry.", picture: null });
  });
});

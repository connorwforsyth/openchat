import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import { pdfOps, pptxOps, writePdf, writePptx } from "./slide-export";
import type { DeckLayout, LayoutColor, SlideLayout } from "./slide-layout";

// The deck's files (164) from a layout tree: what each item becomes, and a
// round trip that parses the files back and counts slides and text.

const ink: LayoutColor = { a: 1, b: 20, g: 20, r: 20 };
const paper: LayoutColor = { a: 1, b: 250, g: 250, r: 250 };
const accent: LayoutColor = { a: 0.5, b: 200, g: 100, r: 0 };

// A 1×1 transparent PNG.
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const text = (
  value: string,
  extra: Partial<SlideLayout["items"][number]> = {}
) =>
  ({
    align: "left",
    bold: false,
    bullet: "none",
    color: ink,
    fontSize: 40,
    h: 60,
    italic: false,
    lineHeight: 1.3,
    text: value,
    type: "text",
    w: 1600,
    x: 144,
    y: 112,
    ...extra,
  }) as SlideLayout["items"][number];

const deck: DeckLayout = {
  slides: [
    {
      background: paper,
      items: [
        {
          fill: accent,
          h: 300,
          line: null,
          radius: 24,
          type: "shape",
          w: 600,
          x: 144,
          y: 400,
        },
        text("Quarterly review", { bold: true, fontSize: 128 }),
        { h: 100, src: PNG, type: "image", w: 100, x: 1700, y: 900 },
      ],
      notes: "Welcome everyone.",
      picture: null,
    },
    {
      background: null,
      items: [
        text("Results"),
        text("Revenue up", { bullet: "bullet", y: 300 }),
        text("Costs down", { bullet: "number", y: 380 }),
        text("   "),
      ],
      notes: "",
      picture: null,
    },
  ],
  title: "Q3",
};

describe("pptxOps", () => {
  it("maps canvas pixels to inches and points, and colours to hex", () => {
    const [shape, title, image] = pptxOps(deck.slides[0] as SlideLayout);
    expect(shape).toEqual({
      kind: "shape",
      options: {
        fill: { color: "0064C8", transparency: 50 },
        h: 2.083,
        rectRadius: 0.16,
        w: 4.167,
        x: 1,
        y: 2.778,
      },
      shape: "roundRect",
    });
    expect(title).toMatchObject({
      kind: "text",
      options: { bold: true, color: "141414", fontSize: 64, x: 1, y: 0.778 },
      text: "Quarterly review",
    });
    expect(image).toMatchObject({
      kind: "image",
      options: { data: PNG.slice("data:".length) },
    });
  });

  it("draws list markers natively and leaves out empty text", () => {
    const ops = pptxOps(deck.slides[1] as SlideLayout);
    expect(ops).toHaveLength(3);
    expect(ops.map((op) => op.kind === "text" && op.options.bullet)).toEqual([
      false,
      true,
      { type: "number" },
    ]);
  });
});

const chart = (
  type: "bar" | "line" | "pie",
  series = [
    { name: "Q2", values: [12, 9] },
    { name: "Q3", values: [15] },
  ]
): SlideLayout["items"][number] => ({
  chart: { labels: ["North", "South"], series, type },
  colors: [ink, accent],
  fontSize: 28,
  h: 640,
  labelColor: ink,
  type: "chart",
  w: 1632,
  x: 144,
  y: 288,
});

const only = (item: SlideLayout["items"][number]): SlideLayout => ({
  background: null,
  items: [item],
  notes: "",
  picture: null,
});

describe("pptxOps charts", () => {
  it("makes a bar chart native, a colour a series, missing values zero", () => {
    expect(pptxOps(only(chart("bar")))).toEqual([
      {
        chartType: "bar",
        data: [
          { labels: ["North", "South"], name: "Q2", values: [12, 9] },
          { labels: ["North", "South"], name: "Q3", values: [15, 0] },
        ],
        kind: "chart",
        options: expect.objectContaining({
          barDir: "col",
          chartColors: ["141414", "0064C8"],
          h: 4.444,
          showLegend: true,
          showValue: true,
          w: 11.333,
          x: 1,
          y: 2,
        }),
      },
    ]);
  });

  it("gives a pie its first series, a colour a slice", () => {
    const [op] = pptxOps(
      only(chart("pie", [{ name: "Mix", values: [62, 25, 13] }]))
    );
    expect(op).toMatchObject({
      chartType: "pie",
      data: [{ name: "Mix", values: [62, 25] }],
      options: { chartColors: ["141414", "0064C8"], showLegend: true },
    });
  });

  it("leaves out a chart with nothing to draw", () => {
    expect(pptxOps(only(chart("line", [])))).toEqual([]);
  });
});

describe("pdfOps", () => {
  it("draws a slide with a picture as that picture under invisible text", () => {
    const ops = pdfOps({ ...(deck.slides[0] as SlideLayout), picture: PNG });
    expect(ops.map((op) => op.kind)).toEqual(["image", "text"]);
    expect(ops[0]).toMatchObject({
      format: "PNG",
      h: 810,
      src: PNG,
      w: 1440,
      x: 0,
      y: 0,
    });
    expect(ops[1]).toMatchObject({
      mode: "invisible",
      text: "Quarterly review",
    });
  });

  it("draws a slide without a picture from its items, background first", () => {
    const [background, , title] = pdfOps(deck.slides[0] as SlideLayout);
    expect(background).toMatchObject({
      fill: paper,
      h: 810,
      kind: "shape",
      w: 1440,
    });
    expect(title).toMatchObject({ mode: "fill" });
    expect(pdfOps(only(chart("bar")))).toEqual([]);
  });

  it("maps canvas pixels to points, a quarter smaller", () => {
    const [, shape, title] = pdfOps(deck.slides[0] as SlideLayout);
    expect(shape).toMatchObject({ h: 225, kind: "shape", radius: 18, w: 450 });
    expect(title).toMatchObject({ font: "bold", fontSize: 96, kind: "text" });
    expect(pdfOps(deck.slides[1] as SlideLayout)[1]).toMatchObject({
      text: "• Revenue up",
    });
  });
});

const MEDIA_BOX = /\/MediaBox \[0 0 1440\.?0* 810\.?0*\]/;

const TEXT_RUN = /<a:t>([^<]*)<\/a:t>/g;
const SLIDE_FILE = /^ppt\/slides\/slide\d+\.xml$/;
const NOTES_FILE = /^ppt\/notesSlides\/notesSlide\d+\.xml$/;
const PAGE = /\/Type \/Page\b/g;

const xmlText = (xml: string): string[] =>
  [...xml.matchAll(TEXT_RUN)].map((match) => match[1] ?? "");

describe("the exported files", () => {
  it("round-trip a .pptx: one slide each, their text, and the notes", async () => {
    const zip = await JSZip.loadAsync(await writePptx(deck));
    const slides = Object.keys(zip.files)
      .filter((name) => SLIDE_FILE.test(name))
      .sort();
    expect(slides).toEqual(["ppt/slides/slide1.xml", "ppt/slides/slide2.xml"]);
    const first =
      (await zip.file("ppt/slides/slide1.xml")?.async("string")) ?? "";
    const second =
      (await zip.file("ppt/slides/slide2.xml")?.async("string")) ?? "";
    expect(xmlText(first)).toEqual(["Quarterly review"]);
    expect(xmlText(second)).toEqual(["Results", "Revenue up", "Costs down"]);
    expect(
      Object.keys(zip.files).some((name) => name.startsWith("ppt/media/"))
    ).toBe(true);
    const notes = Object.keys(zip.files).filter((name) =>
      NOTES_FILE.test(name)
    );
    const allNotes = await Promise.all(
      notes.map((name) => zip.file(name)?.async("string") ?? "")
    );
    expect(allNotes.join("")).toContain("Welcome everyone.");
  });

  it("writes a native chart part into the .pptx", async () => {
    const zip = await JSZip.loadAsync(
      await writePptx({ slides: [only(chart("bar"))], title: "Charts" })
    );
    const chartXml =
      (await zip.file("ppt/charts/chart1.xml")?.async("string")) ?? "";
    expect(chartXml).toContain("<c:barChart>");
    expect(
      (await zip.file("ppt/slides/slide1.xml")?.async("string")) ?? ""
    ).toContain("<c:chart ");
  });

  it("writes a PDF with a page a slide", async () => {
    const pdf = new TextDecoder("latin1").decode(await writePdf(deck));
    expect(pdf.startsWith("%PDF-")).toBe(true);
    expect(pdf.match(PAGE)).toHaveLength(2);
    expect(pdf).toMatch(MEDIA_BOX);
  });
});

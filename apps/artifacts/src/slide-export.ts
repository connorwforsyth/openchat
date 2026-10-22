import { SLIDE_SIZE } from "@workspace/artifacts-kit/kinds/presentation/content";

import {
  type DeckLayout,
  hexOf,
  type LayoutColor,
  type LayoutItem,
  type SlideLayout,
} from "./slide-layout";

// A deck's files (164), from its layout tree (`./slide-layout`): PowerPoint
// through pptxgenjs and PDF through jsPDF, both MIT and both in the
// browser, so the server needs no headless browser. What each item becomes
// is a pure mapping (`pptxOps`, `pdfOps`); the writers only replay it into
// the library, which loads when someone exports.

/** PowerPoint's wide layout is 13.333 × 7.5 inches: 144 canvas pixels an inch. */
const PX_PER_INCH = SLIDE_SIZE.width / 13.333;
/** Points per canvas pixel in PowerPoint (72 points an inch). */
const PPTX_PT_PER_PX = 72 / PX_PER_INCH;
/** A PDF page is the canvas at 0.75 points a pixel (CSS's 96 to 72). */
const PDF_PT_PER_PX = 0.75;

/** A case the types say can't happen: an op added without a writer. */
const unreachable = (value: never): never => {
  throw new Error(`no writer for ${JSON.stringify(value)}`);
};

const inches = (px: number): number =>
  Math.round((px / PX_PER_INCH) * 1000) / 1000;

const transparency = (color: LayoutColor): number =>
  Math.round((1 - color.a) * 100);

export interface PptxChartSeries {
  readonly labels: readonly string[];
  readonly name: string;
  readonly values: readonly number[];
}

export type PptxOp =
  | {
      readonly chartType: "bar" | "line" | "pie";
      readonly data: readonly PptxChartSeries[];
      readonly kind: "chart";
      readonly options: {
        readonly barDir?: "col";
        readonly barGrouping?: "clustered";
        readonly catAxisLabelColor: string;
        readonly catAxisLabelFontSize: number;
        readonly chartColors: readonly string[];
        readonly dataLabelColor: string;
        readonly dataLabelFontSize: number;
        readonly h: number;
        readonly legendColor: string;
        readonly legendFontSize: number;
        readonly legendPos: "b" | "r";
        readonly lineDataSymbol?: "none";
        readonly lineSize?: number;
        readonly showLegend: boolean;
        readonly showValue: boolean;
        readonly valAxisHidden: boolean;
        readonly valGridLine: { readonly style: "none" };
        readonly w: number;
        readonly x: number;
        readonly y: number;
      };
    }
  | {
      readonly kind: "image";
      readonly options: {
        readonly data: string;
        readonly h: number;
        readonly w: number;
        readonly x: number;
        readonly y: number;
      };
    }
  | {
      readonly kind: "shape";
      readonly options: {
        readonly fill?: {
          readonly color: string;
          readonly transparency: number;
        };
        readonly h: number;
        readonly line?: { readonly color: string; readonly width: number };
        readonly rectRadius?: number;
        readonly w: number;
        readonly x: number;
        readonly y: number;
      };
      readonly shape: "rect" | "roundRect";
    }
  | {
      readonly kind: "text";
      readonly options: {
        readonly align: "center" | "left" | "right";
        readonly bold: boolean;
        readonly bullet: boolean | { readonly type: "number" };
        readonly color: string;
        readonly fontSize: number;
        readonly h: number;
        readonly italic: boolean;
        readonly lineSpacingMultiple: number;
        readonly margin: 0;
        readonly transparency: number;
        readonly valign: "top";
        readonly w: number;
        readonly x: number;
        readonly y: number;
      };
      readonly text: string;
    };

const place = (item: LayoutItem) => ({
  h: inches(item.h),
  w: inches(item.w),
  x: inches(item.x),
  y: inches(item.y),
});

const points = (px: number): number =>
  Math.round(px * PPTX_PT_PER_PX * 10) / 10;

/**
 * A native chart: bars and lines one series per colour, a pie its first
 * series one slice per colour, as slide-ui's `Chart` draws them.
 */
const pptxChart = (
  item: Extract<LayoutItem, { type: "chart" }>
): PptxOp | null => {
  const { labels, series, type } = item.chart;
  const data = (type === "pie" ? series.slice(0, 1) : series).map((each) => ({
    labels,
    name: each.name,
    values: labels.map((_, at) => each.values[at] ?? 0),
  }));
  if (data.length === 0 || labels.length === 0) {
    return null;
  }
  const colorCount = type === "pie" ? labels.length : data.length;
  const label = hexOf(item.labelColor);
  const fontSize = points(item.fontSize);
  return {
    chartType: type,
    data,
    kind: "chart",
    options: {
      ...place(item),
      ...(type === "bar" ? { barDir: "col", barGrouping: "clustered" } : {}),
      ...(type === "line" ? { lineDataSymbol: "none", lineSize: 4 } : {}),
      catAxisLabelColor: label,
      catAxisLabelFontSize: fontSize,
      chartColors: Array.from({ length: colorCount }, (_, at) =>
        hexOf(item.colors[at % item.colors.length] ?? item.labelColor)
      ),
      dataLabelColor: label,
      dataLabelFontSize: fontSize,
      legendColor: label,
      legendFontSize: fontSize,
      legendPos: type === "pie" ? "r" : "b",
      showLegend: type === "pie" || data.length > 1,
      showValue: type === "bar",
      valAxisHidden: true,
      valGridLine: { style: "none" },
    },
  };
};

const pptxOp = (item: LayoutItem): PptxOp | null => {
  switch (item.type) {
    case "chart":
      return pptxChart(item);
    case "image":
      // pptxgenjs takes base64 data without the `data:` scheme.
      return {
        kind: "image",
        options: { ...place(item), data: item.src.slice("data:".length) },
      };
    case "shape": {
      if (!(item.fill || item.line)) {
        return null;
      }
      const short = Math.min(item.w, item.h) / 2;
      const rounded = item.radius > 0 && short > 0;
      return {
        kind: "shape",
        options: {
          ...place(item),
          ...(item.fill
            ? {
                fill: {
                  color: hexOf(item.fill),
                  transparency: transparency(item.fill),
                },
              }
            : {}),
          ...(item.line
            ? {
                line: {
                  color: hexOf(item.line.color),
                  width: item.line.width * PPTX_PT_PER_PX,
                },
              }
            : {}),
          ...(rounded ? { rectRadius: Math.min(item.radius / short, 1) } : {}),
        },
        shape: rounded ? "roundRect" : "rect",
      };
    }
    case "text":
      return item.text.trim() === ""
        ? null
        : {
            kind: "text",
            options: {
              ...place(item),
              align: item.align,
              bold: item.bold,
              bullet:
                item.bullet === "number"
                  ? { type: "number" }
                  : item.bullet === "bullet",
              color: hexOf(item.color),
              fontSize: points(item.fontSize),
              italic: item.italic,
              lineSpacingMultiple: item.lineHeight,
              margin: 0,
              transparency: transparency(item.color),
              valign: "top",
            },
            text: item.text,
          };
    default:
      return item satisfies never;
  }
};

/** What PowerPoint draws for one slide, back to front. Pure. */
export const pptxOps = (slide: SlideLayout): readonly PptxOp[] =>
  slide.items.flatMap((item) => {
    const op = pptxOp(item);
    return op ? [op] : [];
  });

type Pptx = InstanceType<typeof import("pptxgenjs").default>;

/** Replays one op onto a pptxgenjs slide. */
const drawPptx = (
  pptx: Pptx,
  slide: ReturnType<Pptx["addSlide"]>,
  op: PptxOp
): void => {
  switch (op.kind) {
    case "chart":
      slide.addChart(
        pptx.ChartType[op.chartType],
        op.data.map((each) => ({
          ...each,
          labels: [...each.labels],
          values: [...each.values],
        })),
        { ...op.options, chartColors: [...op.options.chartColors] }
      );
      return;
    case "image":
      slide.addImage({ ...op.options });
      return;
    case "shape":
      slide.addShape(
        op.shape === "roundRect"
          ? pptx.ShapeType.roundRect
          : pptx.ShapeType.rect,
        { ...op.options }
      );
      return;
    case "text":
      slide.addText(op.text, {
        ...op.options,
        bullet:
          typeof op.options.bullet === "boolean"
            ? op.options.bullet
            : { ...op.options.bullet },
      });
      return;
    default:
      unreachable(op);
  }
};

/** The deck as a `.pptx` file: native shapes, text boxes, charts and pictures, with notes. */
export const writePptx = async (deck: DeckLayout): Promise<Uint8Array> => {
  const { default: PptxGenJS } = await import("pptxgenjs");
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.title = deck.title;
  for (const layout of deck.slides) {
    const slide = pptx.addSlide();
    if (layout.background) {
      slide.background = { color: hexOf(layout.background) };
    }
    for (const op of pptxOps(layout)) {
      drawPptx(pptx, slide, op);
    }
    if (layout.notes) {
      slide.addNotes(layout.notes);
    }
  }
  const data = await pptx.write({ outputType: "uint8array" });
  if (!(data instanceof Uint8Array)) {
    throw new Error("pptxgenjs didn't write bytes");
  }
  return data;
};

export type PdfOp =
  | {
      readonly format: string;
      readonly h: number;
      readonly kind: "image";
      readonly src: string;
      readonly w: number;
      readonly x: number;
      readonly y: number;
    }
  | {
      readonly fill: LayoutColor | null;
      readonly h: number;
      readonly kind: "shape";
      readonly line: {
        readonly color: LayoutColor;
        readonly width: number;
      } | null;
      readonly radius: number;
      readonly w: number;
      readonly x: number;
      readonly y: number;
    }
  | {
      readonly align: "center" | "left" | "right";
      readonly color: LayoutColor;
      readonly font: "bold" | "bolditalic" | "italic" | "normal";
      readonly fontSize: number;
      readonly kind: "text";
      readonly lineHeight: number;
      /** `invisible` over a picture of the slide: there to select and search. */
      readonly mode: "fill" | "invisible";
      readonly text: string;
      readonly w: number;
      readonly x: number;
      readonly y: number;
    };

const pt = (px: number): number => px * PDF_PT_PER_PX;

const IMAGE_FORMAT = /^data:image\/([a-z]+)[;,]/;

const MARKERS = { bullet: "• ", none: "", number: "" } as const;

const pdfOp = (item: LayoutItem, mode: "fill" | "invisible"): PdfOp | null => {
  switch (item.type) {
    case "chart":
      // Charts reach the PDF in the slide's picture; a slide drawn as
      // vectors is a failed one, which has none.
      return null;
    case "image":
      return {
        format: (IMAGE_FORMAT.exec(item.src)?.[1] ?? "png").toUpperCase(),
        h: pt(item.h),
        kind: "image",
        src: item.src,
        w: pt(item.w),
        x: pt(item.x),
        y: pt(item.y),
      };
    case "shape":
      return item.fill || item.line
        ? {
            fill: item.fill,
            h: pt(item.h),
            kind: "shape",
            line: item.line
              ? { color: item.line.color, width: pt(item.line.width) }
              : null,
            radius: pt(item.radius),
            w: pt(item.w),
            x: pt(item.x),
            y: pt(item.y),
          }
        : null;
    case "text": {
      if (item.text.trim() === "") {
        return null;
      }
      const style = `${item.bold ? "bold" : ""}${item.italic ? "italic" : ""}`;
      return {
        align: item.align,
        color: item.color,
        font:
          style === "" ? "normal" : (style as "bold" | "bolditalic" | "italic"),
        fontSize: pt(item.fontSize),
        kind: "text",
        lineHeight: item.lineHeight,
        mode,
        text: `${MARKERS[item.bullet]}${item.text}`,
        w: pt(item.w),
        x: pt(item.x),
        y: pt(item.y),
      };
    }
    default:
      return item satisfies never;
  }
};

const PAGE = { h: pt(SLIDE_SIZE.height), w: pt(SLIDE_SIZE.width) } as const;

/**
 * What a PDF page draws for one slide, in points, back to front. Pure. A
 * slide with a picture is that picture, full bleed, under its text drawn
 * invisibly, so the page looks exactly as the slide did and its words
 * still select and search; one without is drawn from its items.
 */
export const pdfOps = (slide: SlideLayout): readonly PdfOp[] => {
  const page = { ...PAGE, x: 0, y: 0 };
  if (slide.picture) {
    return [
      {
        ...page,
        format: (IMAGE_FORMAT.exec(slide.picture)?.[1] ?? "png").toUpperCase(),
        kind: "image",
        src: slide.picture,
      },
      ...slide.items.flatMap((item) => {
        const op = item.type === "text" ? pdfOp(item, "invisible") : null;
        return op ? [op] : [];
      }),
    ];
  }
  const background: readonly PdfOp[] = slide.background
    ? [
        {
          ...page,
          fill: slide.background,
          kind: "shape",
          line: null,
          radius: 0,
        },
      ]
    : [];
  return [
    ...background,
    ...slide.items.flatMap((item) => {
      const op = pdfOp(item, "fill");
      return op ? [op] : [];
    }),
  ];
};

type Pdf = InstanceType<typeof import("jspdf").jsPDF>;

const drawPdfShape = (
  pdf: Pdf,
  op: Extract<PdfOp, { kind: "shape" }>
): void => {
  if (op.fill) {
    pdf.setFillColor(op.fill.r, op.fill.g, op.fill.b);
  }
  if (op.line) {
    pdf.setDrawColor(op.line.color.r, op.line.color.g, op.line.color.b);
    pdf.setLineWidth(op.line.width);
  }
  const style = `${op.fill ? "F" : ""}${op.line ? "D" : ""}`;
  if (op.radius > 0) {
    pdf.roundedRect(op.x, op.y, op.w, op.h, op.radius, op.radius, style);
  } else {
    pdf.rect(op.x, op.y, op.w, op.h, style);
  }
};

const ANCHOR = { center: 0.5, left: 0, right: 1 } as const;

const drawPdfText = (pdf: Pdf, op: Extract<PdfOp, { kind: "text" }>): void => {
  pdf.setFont("helvetica", op.font);
  pdf.setFontSize(op.fontSize);
  pdf.setTextColor(op.color.r, op.color.g, op.color.b);
  const lines = pdf.splitTextToSize(op.text, op.w) as string[];
  pdf.text(lines, op.x + op.w * ANCHOR[op.align], op.y, {
    align: op.align,
    baseline: "top",
    lineHeightFactor: op.lineHeight,
    renderingMode: op.mode,
  });
};

/** Replays one op onto the PDF's current page. */
const drawPdf = (pdf: Pdf, op: PdfOp): void => {
  switch (op.kind) {
    case "image":
      pdf.addImage(
        op.src,
        op.format,
        op.x,
        op.y,
        op.w,
        op.h,
        undefined,
        "FAST"
      );
      return;
    case "shape":
      drawPdfShape(pdf, op);
      return;
    case "text":
      drawPdfText(pdf, op);
      return;
    default:
      unreachable(op);
  }
};

/** The deck as a PDF: one 1920×1080 page (in points, 1440×810) a slide. */
export const writePdf = async (deck: DeckLayout): Promise<Uint8Array> => {
  const { jsPDF: JsPdf } = await import("jspdf");
  const size: [number, number] = [PAGE.w, PAGE.h];
  const pdf = new JsPdf({ format: size, orientation: "landscape", unit: "pt" });
  pdf.setProperties({ title: deck.title });
  deck.slides.forEach((layout, index) => {
    if (index > 0) {
      pdf.addPage(size, "landscape");
    }
    for (const op of pdfOps(layout)) {
      drawPdf(pdf, op);
    }
  });
  return new Uint8Array(pdf.output("arraybuffer"));
};

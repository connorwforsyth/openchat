import { type Editable, partOf } from "./editable";
import { Heading, Slide } from "./primitives";
import { SLIDE_COLOR, SLIDE_SPACE, SLIDE_TYPE } from "./scale";

// A chart slide (n2): the data in, the drawing out, so a model writes
// numbers instead of hand-drawn SVG. The figure carries its data as
// `data-slide-chart`, which the PowerPoint export reads back to make a
// native, editable chart.

export type ChartType = "bar" | "line" | "pie";

export interface ChartSeries {
  readonly name: string;
  readonly values: readonly number[];
}

export interface ChartProps extends Editable<"caption" | "slide" | "title"> {
  readonly caption?: string;
  /** One label per value: the categories along the axis, or the pie's slices. */
  readonly labels: readonly string[];
  /** One or more series; a pie draws the first. */
  readonly series: readonly ChartSeries[];
  readonly title: string;
  readonly type?: ChartType;
}

const WIDTH = 1632;
const HEIGHT = 640;
const AXIS = 56;
const SERIES_COLORS = [1, 2, 3, 4, 5].map((n) => `var(--chart-${n})`);

const colorOf = (index: number): string =>
  SERIES_COLORS[index % SERIES_COLORS.length] ?? SLIDE_COLOR.accent;

const finite = (value: number | undefined): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

const label = (value: number): string =>
  Number.isInteger(value) ? String(value) : value.toFixed(1);

function Bars({ labels, series }: Pick<ChartProps, "labels" | "series">) {
  const top = Math.max(0, ...series.flatMap((each) => each.values.map(finite)));
  const scale = top === 0 ? 0 : (HEIGHT - AXIS * 2) / top;
  const group = (WIDTH - AXIS) / Math.max(labels.length, 1);
  const bar = (group * 0.7) / Math.max(series.length, 1);
  return (
    <>
      {labels.map((name, at) => (
        <g key={name}>
          {series.map((each, index) => {
            const value = finite(each.values[at]);
            const h = value * scale;
            const x = AXIS + at * group + group * 0.15 + index * bar;
            return (
              <g key={each.name}>
                <rect
                  height={h}
                  rx={8}
                  style={{ fill: colorOf(index) }}
                  width={bar - 8}
                  x={x}
                  y={HEIGHT - AXIS - h}
                />
                <text
                  fontSize={SLIDE_TYPE.caption}
                  style={{ fill: SLIDE_COLOR.foreground }}
                  textAnchor="middle"
                  x={x + (bar - 8) / 2}
                  y={HEIGHT - AXIS - h - 12}
                >
                  {label(value)}
                </text>
              </g>
            );
          })}
          <text
            fontSize={SLIDE_TYPE.caption}
            style={{ fill: SLIDE_COLOR.mutedForeground }}
            textAnchor="middle"
            x={AXIS + at * group + group / 2}
            y={HEIGHT - 8}
          >
            {name}
          </text>
        </g>
      ))}
    </>
  );
}

function Lines({ labels, series }: Pick<ChartProps, "labels" | "series">) {
  const values = series.flatMap((each) => each.values.map(finite));
  const top = Math.max(0, ...values);
  const scale = top === 0 ? 0 : (HEIGHT - AXIS * 2) / top;
  const step = (WIDTH - AXIS * 2) / Math.max(labels.length - 1, 1);
  const xAt = (at: number) => AXIS + at * step;
  return (
    <>
      {series.map((each, index) => (
        <polyline
          fill="none"
          key={each.name}
          points={labels
            .map(
              (_, at) =>
                `${xAt(at)},${HEIGHT - AXIS - finite(each.values[at]) * scale}`
            )
            .join(" ")}
          strokeLinejoin="round"
          strokeWidth={8}
          style={{ stroke: colorOf(index) }}
        />
      ))}
      {labels.map((name, at) => (
        <text
          fontSize={SLIDE_TYPE.caption}
          key={name}
          style={{ fill: SLIDE_COLOR.mutedForeground }}
          textAnchor="middle"
          x={xAt(at)}
          y={HEIGHT - 8}
        >
          {name}
        </text>
      ))}
    </>
  );
}

function Pie({ labels, series }: Pick<ChartProps, "labels" | "series">) {
  const values = (series[0]?.values ?? []).map((value) =>
    Math.max(0, finite(value))
  );
  const total = values.reduce((sum, value) => sum + value, 0);
  const radius = HEIGHT / 2 - 16;
  const cx = HEIGHT / 2;
  const cy = HEIGHT / 2;
  let angle = -Math.PI / 2;
  return (
    <>
      {values.map((value, at) => {
        const sweep = total === 0 ? 0 : (value / total) * Math.PI * 2;
        const start = angle;
        angle += sweep;
        const large = sweep > Math.PI ? 1 : 0;
        const path =
          sweep >= Math.PI * 2 - 1e-6
            ? `M ${cx - radius} ${cy} a ${radius} ${radius} 0 1 0 ${radius * 2} 0 a ${radius} ${radius} 0 1 0 ${-radius * 2} 0`
            : `M ${cx} ${cy} L ${cx + radius * Math.cos(start)} ${cy + radius * Math.sin(start)} A ${radius} ${radius} 0 ${large} 1 ${cx + radius * Math.cos(angle)} ${cy + radius * Math.sin(angle)} Z`;
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: slices are a fixed list from props.
          <path d={path} key={at} style={{ fill: colorOf(at) }} />
        );
      })}
      {labels.map((name, at) => (
        <g key={name}>
          <rect
            height={32}
            rx={6}
            style={{ fill: colorOf(at) }}
            width={32}
            x={HEIGHT + 64}
            y={64 + at * 64}
          />
          <text
            fontSize={SLIDE_TYPE.caption}
            style={{ fill: SLIDE_COLOR.foreground }}
            x={HEIGHT + 112}
            y={90 + at * 64}
          >
            {`${name} · ${label(values[at] ?? 0)}`}
          </text>
        </g>
      ))}
    </>
  );
}

const DRAW = { bar: Bars, line: Lines, pie: Pie } as const;

/** A heading over a bar, line or pie chart drawn from `labels` and `series`. */
/**
 * The chart's data as drawn: labels as text, and series of numbers. A
 * bare list of numbers is one series. Pure.
 */
export const chartDataOf = (
  labels: unknown,
  series: unknown
): Pick<ChartProps, "labels" | "series"> => {
  const names = Array.isArray(labels) ? labels.map(String) : [];
  if (!Array.isArray(series)) {
    return { labels: names, series: [] };
  }
  if (series.every((value) => typeof value === "number")) {
    return { labels: names, series: [{ name: "", values: series }] };
  }
  return {
    labels: names,
    series: series.flatMap((each: unknown, index) => {
      if (typeof each !== "object" || each === null) {
        return [];
      }
      const { name, values } = each as { name?: unknown; values?: unknown };
      return [
        {
          name: typeof name === "string" ? name : `Series ${index + 1}`,
          values: Array.isArray(values) ? values.map(Number) : [],
        },
      ];
    }),
  };
};

export function Chart({
  caption,
  "data-src": source,
  labels: givenLabels,
  series: givenSeries,
  styles,
  title,
  type = "bar",
}: ChartProps) {
  const { labels, series } = chartDataOf(givenLabels, givenSeries);
  const Draw = DRAW[type] ?? Bars;
  return (
    <Slide data-src={source} styles={styles}>
      <Heading part="title" prop="title" style={styles?.title}>
        {title}
      </Heading>
      <figure
        data-slide-chart={JSON.stringify({ labels, series, type })}
        style={{
          display: "flex",
          flex: 1,
          flexDirection: "column",
          gap: SLIDE_SPACE.sm,
          margin: 0,
          minHeight: 0,
        }}
      >
        <svg
          aria-label={title}
          role="img"
          style={{ flex: 1, minHeight: 0, width: "100%" }}
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        >
          <Draw labels={labels} series={series} />
        </svg>
        {series.length > 1 && type !== "pie" ? (
          <figcaption
            style={{
              display: "flex",
              fontSize: SLIDE_TYPE.caption,
              gap: SLIDE_SPACE.md,
            }}
          >
            {series.map((each, index) => (
              <span
                key={each.name}
                style={{
                  alignItems: "center",
                  display: "flex",
                  gap: SLIDE_SPACE.xs,
                }}
              >
                <span
                  style={{
                    background: colorOf(index),
                    borderRadius: 6,
                    display: "inline-block",
                    height: 24,
                    width: 24,
                  }}
                />
                {each.name}
              </span>
            ))}
          </figcaption>
        ) : null}
        {caption ? (
          <p
            {...partOf("caption", "caption")}
            style={{
              color: SLIDE_COLOR.mutedForeground,
              fontSize: SLIDE_TYPE.caption,
              margin: 0,
              ...styles?.caption,
            }}
          >
            {caption}
          </p>
        ) : null}
      </figure>
    </Slide>
  );
}

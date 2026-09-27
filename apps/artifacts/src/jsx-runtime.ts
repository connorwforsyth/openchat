import { jsx, jsxs } from "react/jsx-runtime";

// The JSX runtime React artifacts compile against. The transform runs
// Sucrase's development JSX, which passes each element's source line; this
// stamps it on DOM elements as `data-src="<file>:<line>"`, so the Annotate
// wave (D16) can map a clicked element back to the artifact's source.
// Components and fragments aren't stamped: they don't forward the prop.

export interface JsxSource {
  readonly fileName?: string;
  readonly lineNumber?: number;
}

export const sourceStamp = (source: JsxSource | undefined): string | null =>
  source?.fileName && source.lineNumber
    ? `${source.fileName}:${source.lineNumber}`
    : null;

export const jsxDEV = (
  type: Parameters<typeof jsx>[0],
  props: Record<string, unknown>,
  key: string | undefined,
  isStaticChildren: boolean,
  source?: JsxSource
) => {
  const stamp = typeof type === "string" ? sourceStamp(source) : null;
  const stamped = stamp ? { ...props, "data-src": stamp } : props;
  // `react/jsx-dev-runtime` is a no-op in React's production build, so the
  // element is made by the production runtime either way.
  return isStaticChildren ? jsxs(type, stamped, key) : jsx(type, stamped, key);
};

// biome-ignore lint/performance/noBarrelFile: this module stands in for `react/jsx-runtime`, so it re-exports the rest of it.
export { Fragment, jsx, jsxs } from "react/jsx-runtime";

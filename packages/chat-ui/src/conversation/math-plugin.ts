// KaTeX for Streamdown, in its own chunk (D27): only a message with math
// loads it. rehype-katex renders HTML plus MathML, so formulas stay
// selectable and readable by screen readers.
import "katex/dist/katex.min.css";

// biome-ignore lint/performance/noBarrelFile: the lazy chunk boundary; `markdown.tsx` imports this file dynamically so KaTeX and its CSS load together.
export { math } from "@streamdown/math";

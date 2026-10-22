import type { Compile } from "../../checks";
import { defineArtifactKind } from "../../define";
import {
  PRESENTATION_LIMITS,
  type Presentation,
  presentationContentSchema,
} from "./content";
import { PRESENTATION_EDITS } from "./operations";
import {
  deckShape,
  SLIDE_UI_EXPORTS,
  slideSources,
  slidesCompile,
} from "./slides";

// The Presentation kind (164): a deck of slides, each a React component on
// a fixed 1920×1080 canvas built from `@workspace/slide-ui`, after
// open-slide's model. The runtime draws it (`apps/artifacts`), the panel
// presents it full screen, and it exports to PowerPoint and PDF in the
// browser. The model edits it a slide at a time.

/**
 * What the model is told about presentations: the shape, the edits, and
 * the slide-authoring guide (open-slide's rules: canvas, type scale,
 * palette, layout).
 */
export const PRESENTATION_INSTRUCTIONS = `## Presentations

A presentation is a slide deck the user can present full screen and export to PowerPoint or PDF. Make one with \`create_artifact\`, type "presentation", when they want slides, a deck or a talk. The content is JSON text:

{"title": "Q3 review", "slides": [{"id": "intro", "source": "import { Title } from \\"@workspace/slide-ui\\";\\nexport default function Intro() { return <Title title=\\"Q3 review\\" subtitle=\\"October 2026\\" />; }", "notes": "Welcome everyone."}]}

- Each slide has an \`id\` (lower-case letters, digits and dashes, unique in the deck), a \`source\` and optional speaker \`notes\`. Up to ${PRESENTATION_LIMITS.slides} slides; 5 to 12 is usual.
- A slide's \`source\` is TSX that imports only from \`"@workspace/slide-ui"\` (and \`"react"\` if it needs it) and default-exports one slide. Inside the JSON, escape its quotes as \`\\"\` and its newlines as \`\\n\`.
- To change a deck, call update_artifact with \`edit\` rather than sending it all again: \`update_slide\` (\`slide\`, and \`source\` or \`notes\`), \`add_slide\` (\`slide\`, \`source\`, optional \`notes\` and 0-based \`index\`), \`move_slide\` (\`slide\`, \`index\`), \`delete_slide\` (\`slide\`), or \`replace\` with the whole JSON as \`content\`. One edit per call; edit the latest version you were shown.
- Every slide is compiled when you save. If a save fails, the result names the slide and what to fix: fix that slide and save again.

### Build each slide from one layout

Almost every slide is one layout from \`@workspace/slide-ui\` with its props filled in: that always draws, on the theme, at the right sizes. Props are plain data: strings, and arrays of strings or numbers.

- \`Title({ title, subtitle?, eyebrow? })\`: the opening slide.
- \`Agenda({ items, title?, current? })\`: what the deck covers; \`items\` is an array of strings, \`current\` (0-based) sets one apart.
- \`Section({ title, number?, subtitle? })\`: a divider between parts, on the accent colour.
- \`Bullets({ title, items, steps? })\`: a heading and up to six points; \`items\` is an array of strings. \`steps\` reveals them one at a time.
- \`TwoColumn({ title, left, right })\`: two equal columns; \`left\` and \`right\` are elements, like \`<p>…</p>\` or a \`<ul>\`.
- \`Stat({ value, label, detail?, title? })\`: one number, very large ("42%").
- \`Chart({ title, labels, series, type?, caption? })\`: a bar (default), line or pie chart. \`labels\` are the categories; \`series\` is \`[{ name, values }]\` with one number per label. Use it for any numbers over time or by category, never draw charts by hand.
- \`Quote({ quote, author?, byline? })\`.
- \`ImageSlide({ src, alt, title?, caption?, fit? })\`: \`src\` is a \`data:\` URL; \`fit\` is "contain" (default) or "cover".
- \`Closing({ title, subtitle?, contact? })\`: the last slide.

A whole deck, as the slides' sources:

\`\`\`tsx
import { Title } from "@workspace/slide-ui";
export default function Intro() { return <Title eyebrow="Board update" title="Q3 review" subtitle="Revenue, churn and what's next" />; }
\`\`\`
\`\`\`tsx
import { Bullets } from "@workspace/slide-ui";
export default function Wins() { return <Bullets title="What went well" items={["Revenue up 18%", "Churn down to 3%", "Two senior hires"]} />; }
\`\`\`
\`\`\`tsx
import { Chart } from "@workspace/slide-ui";
export default function Revenue() { return <Chart title="Revenue by month ($k)" labels={["Jul", "Aug", "Sep"]} series={[{ name: "2026", values: [410, 452, 498] }]} />; }
\`\`\`
\`\`\`tsx
import { Closing } from "@workspace/slide-ui";
export default function End() { return <Closing title="Thank you" subtitle="Questions?" />; }
\`\`\`

### When no layout fits

Compose on \`Slide({ children, tone?, align? })\` (\`tone\` is "default", "muted" or "inverse"; \`align\` "start" or "center"), with \`Step\`, \`Notes\` and \`Logo\` as needed.

- **Canvas.** Every slide is 1920×1080 pixels, scaled to fit the screen. Never size anything to the viewport (no \`vw\`, \`vh\` or media queries) and never scroll: what doesn't fit is cut off.
- **Styles** are inline \`style\` objects: there is no Tailwind and no \`className\` styling. Flex and grid, gaps in steps of 8 pixels, logical properties like \`paddingInline\`.
- **Type scale.** display 128, title 96, heading 64, body 40, caption 28; nothing under 28. One idea per slide.
- **Palette.** CSS variables only: \`var(--background)\`, \`var(--foreground)\`, \`var(--muted)\`, \`var(--muted-foreground)\`, \`var(--primary)\` (the accent), \`var(--primary-foreground)\`, \`var(--border)\` and \`var(--chart-1)\` to \`var(--chart-5)\`. Don't write colour values.
- **Pictures** are inline \`<svg>\` or \`data:\` URLs: a slide loads nothing from the network.
- **Steps.** Wrap what should appear on a click in \`<Step>\`; \`<Notes>\` holds speaker notes inside the slide and is never drawn; \`<Logo text? src? alt?>\` puts a mark in the corner.

The components: ${SLIDE_UI_EXPORTS.join(", ")}.

\`\`\`tsx
import { Slide, Step } from "@workspace/slide-ui";

export default function Plan() {
  return (
    <Slide>
      <h2 style={{ fontSize: 64, margin: 0 }}>Three bets for Q4</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 48 }}>
        {["Faster onboarding", "Self-serve billing", "Two new regions"].map((bet) => (
          <Step key={bet}>
            <div style={{ background: "var(--muted)", borderRadius: 24, padding: 48, fontSize: 40 }}>{bet}</div>
          </Step>
        ))}
      </div>
    </Slide>
  );
}
\`\`\``;

export interface PresentationKindOptions {
  /**
   * The runtime's compiler, so a save names a slide that won't compile.
   * The server passes it; without one, slides are compiled when drawn.
   */
  readonly compile?: Compile;
}

export const presentationKindWith = ({
  compile,
}: PresentationKindOptions = {}) =>
  defineArtifactKind<Presentation>({
    capabilities: {
      aiCalls: false,
      // The runtime stamps each element's source line (`data-src`, D16).
      annotate: true,
      present: true,
      share: false,
    },
    checks: [
      deckShape,
      slideSources,
      ...(compile ? [slidesCompile(compile)] : []),
    ],
    content: presentationContentSchema,
    diff: "text",
    editor: "none",
    // JSON first: the deck as stored is its file in the Code tab.
    export: [
      { extension: "json", format: "file" },
      { extension: "pptx", format: "file" },
      { extension: "pdf", format: "file" },
    ],
    icon: "PlayIcon",
    instructions: PRESENTATION_INSTRUCTIONS,
    kind: "presentation",
    label: "Presentation",
    operations: PRESENTATION_EDITS,
    render: {
      imports: ["react", "@workspace/slide-ui"],
      panel: "source",
      runtime: "presentation",
    },
    starter: { badge: "new" },
    thumbnail: "runtime",
  });

export const presentationKind = presentationKindWith();

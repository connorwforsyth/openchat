import { defineArtifactKind } from "../../define";
import {
  PRESENTATION_LIMITS,
  type Presentation,
  presentationContentSchema,
} from "./content";
import { PRESENTATION_EDITS } from "./operations";
import { deckShape, SLIDE_UI_EXPORTS, slideSources } from "./slides";

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

{"title": "Q3 review", "slides": [{"id": "intro", "source": "import { Title } from \\"@workspace/slide-ui\\";\\nexport default function Intro() { return <Title title=\\"Q3 review\\" />; }", "notes": "Welcome everyone."}]}

- Each slide has an \`id\` (lower-case letters, digits and dashes, unique in the deck), a \`source\` and optional speaker \`notes\`. Up to ${PRESENTATION_LIMITS.slides} slides.
- A slide's \`source\` is TSX that imports only from \`"@workspace/slide-ui"\` and \`"react"\` and default-exports one slide.
- To change a deck, call update_artifact with \`edit\` rather than sending it all again: \`update_slide\` (\`slide\`, and \`source\` or \`notes\`), \`add_slide\` (\`slide\`, \`source\`, optional \`notes\` and 0-based \`index\`), \`move_slide\` (\`slide\`, \`index\`), \`delete_slide\` (\`slide\`), or \`replace\` with the whole JSON as \`content\`. One edit per call; edit the latest version you were shown.
- If a save fails its checks, the result says what to fix.

### Slide-authoring guide (slide-ui)

- **Canvas.** Every slide is 1920×1080 pixels, scaled to fit the screen. Never size anything to the viewport (no \`vw\`, \`vh\` or media queries) and never scroll: what doesn't fit on the canvas is cut off.
- **Type scale.** The layouts set the sizes: display 128, title 96, heading 64, body 40, caption 28. When you compose your own, use these sizes and nothing under 28; one idea per slide, at most six bullets of a line or two each.
- **Palette.** Slides are on the instance's theme, light or dark, through CSS variables: \`var(--background)\`, \`var(--foreground)\`, \`var(--muted)\`, \`var(--muted-foreground)\`, \`var(--primary)\` (the accent), \`var(--primary-foreground)\`, \`var(--border)\` and \`var(--chart-1)\` to \`var(--chart-5)\`. Don't write colour values.
- **Layout.** Start from a layout; compose on \`Slide\` only when none fits. Inside \`Slide\`, use plain elements with inline \`style\` (flex and grid, gaps in steps of 8 pixels, logical properties like \`paddingInline\`). Keep content inside the canvas margins.
- **Pictures** are inline \`<svg>\` or \`data:\` URLs: a slide loads nothing from the network.
- **Steps.** Wrap what should appear on a click in \`<Step>\` (or pass \`steps\` to \`Bullets\`); the presenter reveals them in order.

The components (${SLIDE_UI_EXPORTS.join(", ")}):

- \`Title({ title, subtitle?, eyebrow? })\`: the opening slide.
- \`Agenda({ items, title?, current? })\`: what the deck covers; \`current\` (0-based) sets one item apart.
- \`Section({ title, number?, subtitle? })\`: a divider between parts, on the accent colour.
- \`Bullets({ title, items, steps? })\`: a heading and points; \`items\` are strings or elements.
- \`TwoColumn({ title, left, right })\`: two equal columns of elements.
- \`Stat({ value, label, detail?, title? })\`: one number, very large ("42%").
- \`Quote({ quote, author?, byline? })\`.
- \`ImageSlide({ src, alt, title?, caption?, fit? })\`: \`fit\` is "contain" (default) or "cover".
- \`Closing({ title, subtitle?, contact? })\`: the last slide.
- \`Slide({ children, tone?, align? })\`: a blank canvas; \`tone\` is "default", "muted" or "inverse", \`align\` "start" or "center".
- \`Step({ children })\`, \`Notes({ children })\` (speaker notes inside the slide, never drawn) and \`Logo({ text?, src?, alt? })\` (a mark in the corner).

A slide composed on \`Slide\`:

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

export const presentationKind = defineArtifactKind<Presentation>({
  capabilities: {
    aiCalls: false,
    // The runtime stamps each element's source line (`data-src`, D16).
    annotate: true,
    present: true,
    share: false,
  },
  checks: [deckShape, slideSources],
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

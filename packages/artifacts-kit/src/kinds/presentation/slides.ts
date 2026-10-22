import { type Compile, importSpecifiers } from "../../checks";
import type { ArtifactCheck } from "../../define";
import { tsxImports } from "../site/tsx";
import { PRESENTATION_LIMITS, type Presentation } from "./content";

// What a slide may import, read from its source (164). A slide is built from
// `@workspace/slide-ui` and React, and nothing else: the runtime's module
// table (`apps/artifacts/src/presentation.ts`) holds just these, so naming
// the rest at save time saves a broken deck.

export const SLIDE_UI_MODULE = "@workspace/slide-ui";

/** The modules a slide may import. */
export const SLIDE_MODULES = [
  "react",
  "react/jsx-runtime",
  SLIDE_UI_MODULE,
] as const;

/**
 * The components `@workspace/slide-ui` exports. The kit doesn't depend on
 * the package (it's pure, and the package is React), so slide-ui's tests
 * keep this equal to its real exports.
 */
export const SLIDE_UI_EXPORTS = [
  "Agenda",
  "Bullets",
  "Chart",
  "Closing",
  "ImageSlide",
  "Logo",
  "Notes",
  "Quote",
  "Section",
  "Slide",
  "Stat",
  "Step",
  "Title",
  "TwoColumn",
] as const;

const allowedModules = new Set<string>(SLIDE_MODULES);
const slideUiNames = new Set<string>(SLIDE_UI_EXPORTS);
const DEFAULT_EXPORT = /\bexport\s+default\b/;

/** What's wrong with one slide's source, as sentences the model can act on. */
export const slideSourceProblems = (id: string, source: string): string[] => {
  const problems = new Set<string>();
  const at = `slide "${id}"`;
  for (const specifier of importSpecifiers(source)) {
    if (!allowedModules.has(specifier)) {
      problems.add(
        `${at} imports "${specifier}", which a slide can't use. A slide imports only "react" and "${SLIDE_UI_MODULE}"; draw pictures with inline SVG or data: URLs`
      );
    }
  }
  for (const binding of tsxImports(source)) {
    if (binding.specifier !== SLIDE_UI_MODULE) {
      continue;
    }
    if (binding.whole) {
      problems.add(
        `${at} imports all of "${SLIDE_UI_MODULE}" at once; import the layouts by name, like import { Title, Bullets } from "${SLIDE_UI_MODULE}"`
      );
    }
    for (const name of binding.names) {
      if (!slideUiNames.has(name)) {
        problems.add(
          `${at}: ${name} isn't a slide-ui component. It has: ${SLIDE_UI_EXPORTS.join(", ")}`
        );
      }
    }
  }
  if (!DEFAULT_EXPORT.test(source)) {
    problems.add(
      `${at} has no default export: export the slide as \`export default function Intro() { return <Title title="…" />; }\``
    );
  }
  return [...problems];
};

type PresentationCheck = ArtifactCheck<Presentation>;

/** At least one slide, not too many, each id once, and not too much text. */
export const deckShape: PresentationCheck = {
  name: "shape",
  run: (deck) => {
    const ids = deck.slides.map((slide) => slide.id);
    const repeated = [
      ...new Set(ids.filter((id, index) => ids.indexOf(id) !== index)),
    ];
    const chars = JSON.stringify(deck).length;
    return [
      ...(deck.slides.length === 0
        ? ["has no slides: a presentation needs at least one"]
        : []),
      ...(deck.slides.length > PRESENTATION_LIMITS.slides
        ? [
            `has ${deck.slides.length} slides; a presentation may have at most ${PRESENTATION_LIMITS.slides}`,
          ]
        : []),
      ...repeated.map(
        (id) =>
          `has more than one slide with id "${id}": give each slide its own id`
      ),
      ...(chars > PRESENTATION_LIMITS.chars
        ? [
            `is longer than ${PRESENTATION_LIMITS.chars} characters in all; make it smaller`,
          ]
        : []),
    ];
  },
};

/** Each slide imports only React and slide-ui's components, and exports its slide. */
export const slideSources: PresentationCheck = {
  name: "slides",
  run: (deck) =>
    deck.slides.flatMap((slide) => slideSourceProblems(slide.id, slide.source)),
};

/**
 * Each slide compiles, as the runtime will compile it: a slide that
 * doesn't is named with its place in the deck and the compiler's line and
 * column, so the model can fix that slide alone with `update_slide`.
 */
export const slidesCompile = (compile: Compile): PresentationCheck => ({
  name: "compiles",
  run: (deck) =>
    deck.slides.flatMap((slide, index) => {
      const problem = compile(slide.source);
      return problem === null
        ? []
        : [
            `slide "${slide.id}" (slide ${index + 1}) doesn't compile: ${problem}. Fix its TSX and save it again; the other slides are fine`,
          ];
    }),
});

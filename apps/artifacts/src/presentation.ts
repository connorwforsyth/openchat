import {
  presentationContentSchema,
  slideFileName,
} from "@workspace/artifacts-kit/kinds/presentation/content";
import { SLIDE_MODULES } from "@workspace/artifacts-kit/kinds/presentation/slides";
import type {
  PresentAction,
  RuntimeError,
} from "@workspace/chat-ui/artifacts/runtime-protocol";
import { err, flatMap, ok, type Result } from "@workspace/shared/result";
// biome-ignore lint/performance/noNamespaceImport: a slide's `require("@workspace/slide-ui")` gets the whole module.
import * as slideUi from "@workspace/slide-ui";
import type { ReactElement } from "react";
// biome-ignore lint/performance/noNamespaceImport: as above, for `react`.
import * as React from "react";

// biome-ignore lint/performance/noNamespaceImport: the compiled slide requires the runtime as a module.
import * as jsxRuntime from "./jsx-runtime";
import {
  artifactElement,
  compileArtifact,
  evaluateArtifact,
} from "./react-artifact";

// Presentations in the runtime (164): the deck's JSON in, one React element
// per slide out. Each slide compiles and runs as a React artifact does
// (`./react-artifact`), against a module table that adds
// `@workspace/slide-ui`, and its elements are stamped `data-src` with the
// slide's own file name (`slides/<id>.tsx`), so Annotate works as it does
// for React. Where the presenter goes next is a pure function of where they
// are and how many steps each slide has.

/** What `require` resolves to inside a slide. */
export const slideModules: Readonly<Record<string, unknown>> = {
  "@workspace/slide-ui": slideUi,
  react: React,
  "react/jsx-dev-runtime": jsxRuntime,
  "react/jsx-runtime": jsxRuntime,
};

// The JSX runtimes are the transform's, not the author's to ask for.
const permitted = new Set<string>([...SLIDE_MODULES, "react/jsx-dev-runtime"]);

export interface LoadedSlide {
  readonly element: Result<ReactElement, RuntimeError>;
  readonly id: string;
  /** The deck's notes for the slide; a slide's `<Notes>` add to them. */
  readonly notes: string;
}

export interface LoadedDeck {
  readonly slides: readonly LoadedSlide[];
  readonly title: string;
}

/** One slide's element: compiled, run against the table, its default export. */
export const loadSlide = (
  source: string,
  id: string
): Result<ReactElement, RuntimeError> =>
  flatMap(
    flatMap(compileArtifact(source, slideFileName(id)), (compiled) =>
      evaluateArtifact(compiled, slideModules, permitted)
    ),
    artifactElement
  );

/**
 * The deck, with each slide loaded on its own: one broken slide is that
 * slide's error, not the deck's. Content that isn't a deck is a `syntax`
 * error.
 */
export const loadPresentation = (
  code: string
): Result<LoadedDeck, RuntimeError> => {
  const parsed = presentationContentSchema.safeParse(code);
  if (!parsed.success) {
    return err({
      kind: "syntax",
      message: parsed.error.issues[0]?.message ?? "isn't a presentation",
    });
  }
  return ok({
    slides: parsed.data.slides.map((slide) => ({
      element: loadSlide(slide.source, slide.id),
      id: slide.id,
      notes: slide.notes ?? "",
    })),
    title: parsed.data.title,
  });
};

/** Where the presenter is: a slide, and how many of its steps show. */
export interface DeckPosition {
  readonly slide: number;
  readonly step: number;
}

export const START: DeckPosition = { slide: 0, step: 0 };

/**
 * Where `action` takes the presenter from `at`, given each slide's step
 * count: forward reveals the slide's next step, then the next slide; back
 * hides the last step shown, then goes to the previous slide with all of
 * its steps showing. Pure.
 */
export const nextPosition = (
  at: DeckPosition,
  action: PresentAction,
  steps: readonly number[]
): DeckPosition => {
  const last = steps.length - 1;
  if (last < 0) {
    return START;
  }
  const slide = Math.min(Math.max(at.slide, 0), last);
  const step = Math.min(Math.max(at.step, 0), steps[slide] ?? 0);
  switch (action) {
    case "enter":
    case "exit":
      return { slide, step };
    case "first":
      return START;
    case "last":
      return { slide: last, step: steps[last] ?? 0 };
    case "next":
      if (step < (steps[slide] ?? 0)) {
        return { slide, step: step + 1 };
      }
      return slide < last ? { slide: slide + 1, step: 0 } : { slide, step };
    case "previous":
      if (step > 0) {
        return { slide, step: step - 1 };
      }
      return slide > 0
        ? { slide: slide - 1, step: steps[slide - 1] ?? 0 }
        : { slide, step };
    default:
      return action satisfies never;
  }
};

/** The slide's speaker notes: the deck's, then any written in the slide. */
export const notesOf = (deck: string, inSlide: readonly string[]): string =>
  [deck, ...inSlide]
    .map((each) => each.trim())
    .filter(Boolean)
    .join("\n\n");

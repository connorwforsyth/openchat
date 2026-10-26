import { builtinArtifactKinds } from "@workspace/artifacts-kit/builtin";
import { themeDeclarations } from "@workspace/artifacts-kit/kind-theme";
import {
  type ExportRequest,
  type FrameMessage,
  type PresentRequest,
  type RenderRequest,
  RUNTIME_CHANNEL,
  type RuntimeError,
  type SelectRequest,
} from "@workspace/chat-ui/artifacts/runtime-protocol";
import { parseSvg, renderHtml, type Teardown } from "./documents";
import { runtimeError } from "./errors";
import { pageKindThemes, themeOf } from "./kind-themes";

// One renderer per `render.runtime` a kind definition names
// (`@workspace/artifacts-kit`, 123). The page (`main.ts`) looks the
// request's kind up in the registry and hands it to that renderer, so a new
// kind that draws like an existing one is a definition, not a new branch
// here. React and Mermaid load on first use.

/** What the host may ask of a render once it's drawn: a deck's (164). */
export type RenderControl = ExportRequest | PresentRequest | SelectRequest;

/** What a renderer reports through, for the render it was given. */
export interface RenderContext {
  readonly done: () => void;
  readonly fail: (error: RuntimeError) => void;
  /** Whether this render is still the one on screen. */
  readonly isCurrent: () => boolean;
  /** Takes the host's requests for this render, until the next one. */
  readonly listen: (handler: (control: RenderControl) => void) => void;
  /** Tells the host something more than drawn or failed (a deck's position). */
  readonly post: (message: FrameMessage) => void;
}

/** Draws `request` into `container`; returns what undoes it, if anything. */
export type Renderer = (
  container: HTMLElement,
  request: RenderRequest,
  context: RenderContext
) => Promise<Teardown | null>;

const html: Renderer = (container, request, { done, fail }) =>
  Promise.resolve(
    renderHtml(container, request.code, { onError: fail, onLoad: done })
  );

const svg: Renderer = (container, request, { done, fail }) => {
  const parsed = parseSvg(request.code);
  if (parsed.ok) {
    container.append(parsed.value);
    done();
  } else {
    fail(parsed.error);
  }
  return Promise.resolve(null);
};

const mermaid: Renderer = async (container, request, context) => {
  const { renderMermaid } = await import("./mermaid");
  const rendered = await renderMermaid(request.code, request.theme);
  if (!context.isCurrent()) {
    return null;
  }
  if (rendered.ok) {
    // Mermaid sanitises its own output (`securityLevel: "strict"`).
    container.innerHTML = rendered.value;
    context.done();
  } else {
    context.fail(rendered.error);
  }
  return null;
};

const react: Renderer = async (container, request, context) => {
  const { loadReactArtifact, mountReactArtifact } = await import(
    "./react-artifact"
  );
  if (!context.isCurrent()) {
    return null;
  }
  const element = loadReactArtifact(request.code, request.fileName);
  if (!element.ok) {
    context.fail(element.error);
    return null;
  }
  const teardown = mountReactArtifact(container, element.value, context.fail);
  context.done();
  return teardown;
};

/**
 * Presentations (164): every slide compiled like React, scaled to fit, and
 * presented and exported when the host asks.
 */
const presentation: Renderer = async (container, request, context) => {
  const [{ loadPresentation }, { mountDeck }, { slideDeckCss }, assets] =
    await Promise.all([
      import("./presentation"),
      import("./presentation-deck"),
      import("./slide-theme"),
      import("./slide-assets"),
    ]);
  if (!context.isCurrent()) {
    return null;
  }
  const deck = loadPresentation(request.code);
  if (!deck.ok) {
    context.fail(deck.error);
    return null;
  }
  const controller = mountDeck(container, deck.value, {
    css: slideDeckCss(
      assets.SLIDE_ASSETS.themeCss,
      request.theme,
      themeDeclarations(
        themeOf(pageKindThemes(document), "presentation"),
        request.theme
      )
    ),
    editing: {
      focus: request.focus,
      inspect: request.inspect,
      onPicked: (element) =>
        context.post({
          channel: RUNTIME_CHANNEL,
          element,
          id: request.id,
          type: "picked",
        }),
      selection: request.selection,
    },
    onError: context.fail,
    onLayout: (slides) =>
      context.post({
        channel: RUNTIME_CHANNEL,
        id: request.id,
        slides: [...slides],
        type: "layout",
      }),
    onPosition: (position) =>
      context.post({
        ...position,
        channel: RUNTIME_CHANNEL,
        id: request.id,
        type: "position",
      }),
    view: request.view,
  });
  context.listen((control) => {
    if (control.type === "present") {
      controller.control(control.action);
      return;
    }
    if (control.type === "select") {
      controller.select(control.focus, control.selection);
      return;
    }
    const { format, id, request: asked } = control;
    controller
      .exportAs(format)
      .then((data) =>
        context.post({
          channel: RUNTIME_CHANNEL,
          // A copy on a plain ArrayBuffer, as the protocol takes it.
          data: new Uint8Array(data),
          format,
          id,
          request: asked,
          type: "exported",
        })
      )
      .catch((error: unknown) =>
        context.post({
          channel: RUNTIME_CHANNEL,
          id,
          message: runtimeError("render", error).message,
          request: asked,
          type: "export-failed",
        })
      );
  });
  context.done();
  return controller.teardown;
};

/**
 * Sites (125) render on their own page, `site.html`, whose CSP lets in the
 * instance's public origins; this page's CSP lets in nothing, so it only
 * says where to go.
 */
const site: Renderer = (_container, _request, { fail }) => {
  fail({
    kind: "render",
    message: "Sites are previewed by the runtime's site page (site.html).",
  });
  return Promise.resolve(null);
};

/** The renderers, by the name a kind's `render.runtime` gives. */
export const runtimeRenderers: Readonly<Record<string, Renderer>> = {
  html,
  mermaid,
  presentation,
  react,
  site,
  svg,
};

/** The renderer for an artifact of `kind`, or `null` if the runtime has none. */
export const rendererFor = (kind: string): Renderer | null => {
  const name = builtinArtifactKinds.get(kind)?.render.runtime;
  return (name && runtimeRenderers[name]) || null;
};

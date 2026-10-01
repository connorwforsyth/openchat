import { builtinArtifactKinds } from "@workspace/artifacts-kit/builtin";
import type {
  RenderRequest,
  RuntimeError,
} from "@workspace/chat-ui/artifacts/runtime-protocol";

import { parseSvg, renderHtml, type Teardown } from "./documents";

// One renderer per `render.runtime` a kind definition names
// (`@workspace/artifacts-kit`, 123). The page (`main.ts`) looks the
// request's kind up in the registry and hands it to that renderer, so a new
// kind that draws like an existing one is a definition, not a new branch
// here. React and Mermaid load on first use.

/** What a renderer reports through, for the render it was given. */
export interface RenderContext {
  readonly done: () => void;
  readonly fail: (error: RuntimeError) => void;
  /** Whether this render is still the one on screen. */
  readonly isCurrent: () => boolean;
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

/** The renderers, by the name a kind's `render.runtime` gives. */
export const runtimeRenderers: Readonly<Record<string, Renderer>> = {
  html,
  mermaid,
  react,
  svg,
};

/** The renderer for an artifact of `kind`, or `null` if the runtime has none. */
export const rendererFor = (kind: string): Renderer | null => {
  const name = builtinArtifactKinds.get(kind)?.render.runtime;
  return (name && runtimeRenderers[name]) || null;
};

import { reactKind } from "@workspace/artifacts-kit/kinds/react";
import type { RuntimeError } from "@workspace/chat-ui/artifacts/runtime-protocol";
import { err, flatMap, ok, type Result } from "@workspace/shared/result";
// biome-ignore lint/performance/noNamespaceImport: artifacts get the whole module, as `import * as React` would give them.
import * as React from "react";
import {
  type ComponentType,
  createElement,
  isValidElement,
  type ReactElement,
} from "react";
// biome-ignore lint/performance/noNamespaceImport: as above, for `react-dom`.
import * as ReactDOM from "react-dom";
import { createRoot } from "react-dom/client";
import { transform } from "sucrase";

import { runtimeError } from "./errors";
// biome-ignore lint/performance/noNamespaceImport: the compiled code requires the runtime as a module.
import * as jsxRuntime from "./jsx-runtime";

// React artifacts: TSX in, a mounted component out. Sucrase strips types and
// compiles JSX and ES imports to CommonJS in a few milliseconds, small enough
// to ship to the frame (esbuild-wasm is ~10 MB). Imports resolve against a
// fixed table of bundled modules, never the network. Which modules is the
// React kind's to say (`render.imports` in `@workspace/artifacts-kit`).

export interface CompiledArtifact {
  readonly code: string;
  /** Every module the code requires, in order of first use. */
  readonly imports: readonly string[];
}

const REQUIRE = /\brequire\((["'])([^"'\n]+)\1\)/g;

export const compileArtifact = (
  source: string,
  fileName: string
): Result<CompiledArtifact, RuntimeError> => {
  try {
    const { code } = transform(source, {
      filePath: fileName,
      jsxRuntime: "automatic",
      // Development JSX passes each element's line to `jsxDEV`, which stamps
      // `data-src` (see ./jsx-runtime).
      production: false,
      transforms: ["typescript", "jsx", "imports"],
    });
    const imports = [
      ...new Set([...code.matchAll(REQUIRE)].map((match) => match[2] ?? "")),
    ];
    return ok({ code, imports });
  } catch (error) {
    return err(runtimeError("syntax", error));
  }
};

/** What `require` resolves to inside an artifact. */
export const artifactModules: Readonly<Record<string, unknown>> = {
  react: React,
  "react-dom": ReactDOM,
  "react/jsx-dev-runtime": jsxRuntime,
  "react/jsx-runtime": jsxRuntime,
};

// The JSX runtimes are the transform's, not the author's to ask for.
const allowed = new Set<string>([
  ...(reactKind.render.imports ?? []),
  "react/jsx-dev-runtime",
  "react/jsx-runtime",
]);

/** Runs the compiled module and returns its exports. */
export const evaluateArtifact = (
  compiled: CompiledArtifact,
  modules: Readonly<Record<string, unknown>> = artifactModules
): Result<Readonly<Record<string, unknown>>, RuntimeError> => {
  const blocked = compiled.imports.find(
    (specifier) =>
      !(allowed.has(specifier) && Object.hasOwn(modules, specifier))
  );
  if (blocked !== undefined) {
    return err({ kind: "import", message: blocked });
  }
  const require = (specifier: string): unknown => {
    if (allowed.has(specifier) && Object.hasOwn(modules, specifier)) {
      return modules[specifier];
    }
    throw new Error(`Cannot import "${specifier}"`);
  };
  const module: { exports: Record<string, unknown> } = { exports: {} };
  try {
    // Running the artifact is the point: it runs in the sandboxed,
    // opaque-origin frame with no network (D24).
    const run = new Function("require", "module", "exports", compiled.code);
    run(require, module, module.exports);
  } catch (error) {
    return err(runtimeError("render", error));
  }
  return ok(module.exports);
};

/** The element to mount: the default export, called as a component if it is one. */
export const artifactElement = (
  exports: Readonly<Record<string, unknown>>
): Result<ReactElement, RuntimeError> => {
  const value = exports.default;
  if (typeof value === "function") {
    return ok(createElement(value as ComponentType));
  }
  if (isValidElement(value)) {
    return ok(value);
  }
  return err({ kind: "export", message: "" });
};

export const loadReactArtifact = (
  source: string,
  fileName: string
): Result<ReactElement, RuntimeError> =>
  flatMap(
    flatMap(compileArtifact(source, fileName), (compiled) =>
      evaluateArtifact(compiled)
    ),
    artifactElement
  );

/**
 * Mounts the element; errors while rendering (and after, from effects) go to
 * `onError`. Returns the unmount.
 */
export const mountReactArtifact = (
  container: Element,
  element: ReactElement,
  onError: (error: RuntimeError) => void
): (() => void) => {
  const report = (error: unknown) => onError(runtimeError("render", error));
  const root = createRoot(container, {
    onCaughtError: report,
    onRecoverableError: report,
    onUncaughtError: report,
  });
  root.render(element);
  return () => root.unmount();
};

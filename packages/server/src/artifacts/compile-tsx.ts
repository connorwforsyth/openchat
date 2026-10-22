import type { Compile } from "@workspace/artifacts-kit/checks";
import { transform } from "sucrase";

// The artifact runtime's compiler (sucrase, `apps/artifacts`), run on the
// server when a slide is saved, so a slide that won't compile is the
// model's to fix before anyone opens the deck. It only parses and
// transforms; nothing it compiles runs here.

const POSITION = /\((\d+):(\d+)\)/;

/** The compiler's message, with the source line it points at. */
const withSourceLine = (source: string, message: string): string => {
  const at = POSITION.exec(message);
  const line = at ? source.split("\n")[Number(at[1]) - 1] : undefined;
  const near = line?.trim().slice(0, 160);
  return near ? `${message}, at \`${near}\`` : message;
};

export const compileTsx: Compile = (source) => {
  try {
    transform(source, {
      jsxRuntime: "automatic",
      production: true,
      transforms: ["typescript", "jsx", "imports"],
    });
    return null;
  } catch (error) {
    return withSourceLine(
      source,
      error instanceof Error ? error.message : String(error)
    );
  }
};

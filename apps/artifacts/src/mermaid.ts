import type {
  RuntimeError,
  RuntimeTheme,
} from "@workspace/chat-ui/artifacts/runtime-protocol";
import { err, ok, type Result } from "@workspace/shared/result";
import mermaid from "mermaid";

import { runtimeError } from "./errors";

// Mermaid artifacts, in their own chunk: Mermaid is most of the runtime's
// weight and most previews never need it.

let diagrams = 0;

export const renderMermaid = async (
  source: string,
  theme: RuntimeTheme
): Promise<Result<string, RuntimeError>> => {
  mermaid.initialize({
    // Strict: no click handlers or HTML labels from the diagram text.
    securityLevel: "strict",
    startOnLoad: false,
    theme: theme === "dark" ? "dark" : "default",
  });
  try {
    await mermaid.parse(source);
  } catch (error) {
    return err(runtimeError("syntax", error));
  }
  diagrams += 1;
  try {
    const { svg } = await mermaid.render(`diagram-${diagrams}`, source);
    return ok(svg);
  } catch (error) {
    return err(runtimeError("render", error));
  }
};

import {
  RUNTIME_IMPORTS,
  runtimeKindSchema,
} from "@workspace/chat-ui/artifacts/runtime-protocol";
import { describe, expect, it } from "vitest";

import { artifactModules, evaluateArtifact } from "./react-artifact";

// The golden snapshot of what the runtime renders and what a React artifact
// may import (ticket 123), written before the artifact framework existed and
// kept byte-identical after it. If a change is intended, change the snapshot
// in the same commit and say so.

// Not `.json`: the formatter would rewrite what the test writes.
const SNAPSHOT = "./__snapshots__/runtime-golden.json.snap";

/** Specifiers an artifact might ask for, allowed or not. */
const CANDIDATES = [
  "react",
  "react-dom",
  "react-dom/client",
  "react-dom/server",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
  "React",
  "react/",
  "lucide-react",
  "recharts",
  "lodash",
  "./Button",
  "https://esm.sh/react",
  "node:fs",
  "constructor",
  "__proto__",
  "hasOwnProperty",
] as const;

describe("the artifact runtime", () => {
  it("renders and allows what it did before the artifact framework", async () => {
    const imports = Object.fromEntries(
      CANDIDATES.map((specifier) => {
        const result = evaluateArtifact({
          code: "",
          imports: [specifier],
        });
        return [specifier, result.ok ? "allowed" : result.error.kind];
      })
    );
    const golden = {
      imports,
      modules: Object.keys(artifactModules).sort(),
      runtimeImports: RUNTIME_IMPORTS,
      runtimeKinds: runtimeKindSchema.options,
    };
    await expect(`${JSON.stringify(golden, null, 2)}\n`).toMatchFileSnapshot(
      SNAPSHOT
    );
  });
});

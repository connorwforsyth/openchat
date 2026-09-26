import { describe, expect, it } from "vitest";

import { parseArtifacts } from "./format";

// The eval is only as good as its reader: it must catch broken replies, not
// just pass good ones.

const fence = "```";
const artifact = (header: string, body: string[], language = "tsx") =>
  [header, `${fence}${language}`, ...body, fence, ":::"].join("\n");

describe("parseArtifacts", () => {
  it("reads a well-formed artifact, fences inside the code and all", () => {
    const reply = artifact(
      ':::artifact{identifier="readme" type="markdown" title="Readme"}',
      ["# Title", "", ":::", "not a close: it's inside the fence"],
      "md"
    );
    // The inner `:::` sits inside the fence, so it doesn't close the artifact.
    expect(parseArtifacts(reply)).toMatchObject({
      artifacts: [{ identifier: "readme", kind: "markdown", language: "md" }],
      problems: [],
    });
  });

  it("flags every kind of breakage", () => {
    const cases = [
      [
        ':::artifact{identifier="x" type="react" title="X"}\n```tsx\nexport default 1\n```',
        "never closed",
      ],
      [
        artifact(':::artifact{identifier="Bad Id" type="react" title="X"}', [
          "export default 1",
        ]),
        "identifier",
      ],
      [
        artifact(':::artifact{identifier="x" type="pdf" title="X"}', ["a"]),
        "type",
      ],
      [
        artifact(':::artifact{identifier="x" type="react" title=""}', [
          "export default 1",
        ]),
        "title",
      ],
      [
        ':::artifact{identifier="x" type="code" title="X"}\nprint(1)\n:::',
        "one fenced code block",
      ],
      [
        artifact(':::artifact{identifier="x" type="react" title="X"}', [
          "function App() {}",
        ]),
        "valid react",
      ],
      [
        artifact(
          ':::artifact{identifier="x" type="svg" title="X"}',
          ["<div></div>"],
          "svg"
        ),
        "valid svg",
      ],
      [
        [
          artifact(':::artifact{identifier="x" type="code" title="A"}', ["1"]),
          artifact(':::artifact{identifier="x" type="code" title="B"}', ["2"]),
        ].join("\n\n"),
        "used twice",
      ],
    ] as const;
    for (const [reply, problem] of cases) {
      const parsed = parseArtifacts(reply);
      expect(parsed.problems.join("; ")).toContain(problem);
    }
  });
});

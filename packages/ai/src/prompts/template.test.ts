import { describe, expect, it } from "vitest";

import { fillPrompt } from "./template";

describe("fillPrompt", () => {
  it("fills each placeholder, however often it appears", () => {
    expect(fillPrompt("{{a}} and {{b}}, then {{a}}", { a: "1", b: "2" })).toBe(
      "1 and 2, then 1"
    );
  });

  it("leaves a value alone, even one that looks like a template", () => {
    expect(
      fillPrompt("<file>{{content}}</file>{{path}}", {
        content: "{{path}} costs $1, $& and $$",
        path: "a.txt",
      })
    ).toBe("<file>{{path}} costs $1, $& and $$</file>a.txt");
  });

  it("throws on a placeholder nobody gave a value for", () => {
    expect(() => fillPrompt("{{missing}}", {})).toThrow(
      "no value for the prompt placeholder {{missing}}"
    );
  });
});

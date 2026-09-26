import { describe, expect, it } from "vitest";

import {
  fillTemplate,
  initialVariableValues,
  parseTemplateVariables,
  resolvePromptVariables,
} from "./variables";

describe("parseTemplateVariables", () => {
  it("lists placeholders in order of first appearance, once each", () => {
    expect(
      parseTemplateVariables("{{topic}} for {{ audience }}, about {{topic}}")
    ).toEqual(["topic", "audience"]);
  });

  it("ignores text that only looks like a placeholder", () => {
    expect(
      parseTemplateVariables("{{}} {{1st}} {topic} {{two words}} {{ok_2}}")
    ).toEqual(["ok_2"]);
  });

  it("finds nothing in a plain template", () => {
    expect(parseTemplateVariables("Summarise this.")).toEqual([]);
  });
});

describe("resolvePromptVariables", () => {
  it("takes descriptions and defaults from the definition, in template order", () => {
    expect(
      resolvePromptVariables({
        template: "Explain {{topic}} to {{audience}}",
        variables: [
          { default: "a beginner", name: "audience" },
          { description: "What to explain", name: "topic" },
          { name: "unused" },
        ],
      })
    ).toEqual([
      { description: "What to explain", name: "topic" },
      { default: "a beginner", name: "audience" },
    ]);
  });

  it("asks for undeclared placeholders too", () => {
    expect(
      resolvePromptVariables({ template: "Hi {{name}}", variables: [] })
    ).toEqual([{ name: "name" }]);
  });
});

describe("initialVariableValues", () => {
  it("starts from each default, or empty", () => {
    expect(
      initialVariableValues([
        { default: "en", name: "lang" },
        { name: "topic" },
      ])
    ).toEqual({ lang: "en", topic: "" });
  });
});

describe("fillTemplate", () => {
  it("replaces every occurrence, with or without inner spaces", () => {
    expect(
      fillTemplate("{{a}} and {{ a }} then {{b}}", { a: "x", b: "y" })
    ).toEqual({ ok: true, value: "x and x then y" });
  });

  it("falls back to a declared default for a blank value", () => {
    expect(
      fillTemplate("Hello {{name}}", { name: "  " }, [
        { default: "there", name: "name" },
      ])
    ).toEqual({ ok: true, value: "Hello there" });
  });

  it("reports every missing variable, in template order", () => {
    expect(fillTemplate("{{b}} {{a}} {{c}}", { c: "set" })).toEqual({
      error: { code: "missing_variables", names: ["b", "a"] },
      ok: false,
    });
  });

  it("inserts values literally, without expanding placeholders inside them", () => {
    expect(fillTemplate("{{a}} {{b}}", { a: "{{b}}", b: "$&" })).toEqual({
      ok: true,
      value: "{{b}} $&",
    });
  });
});

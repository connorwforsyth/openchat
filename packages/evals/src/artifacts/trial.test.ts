import { describe, expect, it } from "vitest";

import {
  classifyTrial,
  type ObservedCall,
  summarizeKind,
  summaryTable,
  type Trial,
  type TrialObservation,
} from "./trial";

const saved = (kind: string, id = "a1"): ObservedCall => ({
  input: { content: "…", title: "T", type: kind },
  name: "create_artifact",
  output: {
    artifact: { artifactId: id, kind, title: "T", versionId: "v1" },
    status: "saved",
    version: 1,
  },
  result: "success",
});

const invalid = (problems: string[]): ObservedCall => ({
  input: { content: "{", title: "T", type: "presentation" },
  name: "create_artifact",
  output: { problems, status: "invalid" },
  result: "success",
});

const observation = (
  overrides: Partial<TrialObservation> = {}
): TrialObservation => ({
  calls: [],
  msToSaved: null,
  render: null,
  runError: null,
  runMs: 1000,
  runStatus: "succeeded",
  text: "",
  ...overrides,
});

const rendered = {
  message: null,
  ms: 500,
  screenshot: "s.png",
  status: "rendered" as const,
};

describe("classifyTrial", () => {
  it("passes a saved artifact of the kind asked for that rendered", () => {
    const verdict = classifyTrial(
      "svg",
      observation({ calls: [saved("svg")], render: rendered })
    );
    expect(verdict.category).toBeNull();
    expect(verdict.attempts).toBe(1);
  });

  it("names the renderer's error when the artifact didn't draw", () => {
    const verdict = classifyTrial(
      "react",
      observation({
        calls: [saved("react")],
        render: {
          ...rendered,
          message: "syntax: Unexpected token",
          status: "error",
        },
      })
    );
    expect(verdict).toMatchObject({
      category: "render_error",
      detail: "syntax: Unexpected token",
    });
  });

  it("is a render timeout when nothing ever said it drew", () => {
    expect(
      classifyTrial("site", observation({ calls: [saved("site")] })).category
    ).toBe("render_timeout");
  });

  it("passes after a retry fixed what the checks refused", () => {
    const verdict = classifyTrial(
      "presentation",
      observation({
        calls: [invalid(["slides is required"]), saved("presentation")],
        render: rendered,
      })
    );
    expect(verdict).toMatchObject({ attempts: 2, category: null });
  });

  it("is the wrong kind when only another kind was saved", () => {
    expect(
      classifyTrial("site", observation({ calls: [saved("html")] }))
    ).toMatchObject({ category: "wrong_kind", savedKinds: ["html"] });
  });

  it("collects the checks' problems when every attempt was refused", () => {
    const verdict = classifyTrial(
      "presentation",
      observation({ calls: [invalid(["a"]), invalid(["b"])] })
    );
    expect(verdict).toMatchObject({
      category: "schema_invalid",
      detail: "a; b",
    });
  });

  it("tells a call whose input didn't parse from no call at all", () => {
    const errored: ObservedCall = {
      input: { title: "T" },
      name: "create_artifact",
      output: "Invalid input: content is required",
      result: "error",
    };
    expect(
      classifyTrial("svg", observation({ calls: [errored] })).category
    ).toBe("tool_input_invalid");
    expect(
      classifyTrial("svg", observation({ text: "Here is your SVG: <svg>" }))
    ).toMatchObject({
      category: "no_tool_call",
      detail: "Here is your SVG: <svg>",
    });
  });

  it("tells work saved as a workspace file from a plain answer", () => {
    const write: ObservedCall = {
      input: { content: "<html>", path: "/work/page.html" },
      name: "write",
      output: "ok",
      result: "success",
    };
    expect(
      classifyTrial("html", observation({ calls: [write], text: "Done." }))
    ).toMatchObject({
      category: "workspace_file",
      detail: "write /work/page.html: Done.",
    });
  });

  it("ignores other tools and reports a failed run", () => {
    const guide: ObservedCall = {
      input: { type: "site" },
      name: "load_artifact_guide",
      output: "guide",
      result: "success",
    };
    expect(
      classifyTrial(
        "site",
        observation({
          calls: [guide],
          runError: "overloaded",
          runStatus: "failed",
        })
      )
    ).toMatchObject({
      attempts: 0,
      category: "run_failed",
      detail: "overloaded",
    });
  });
});

const trial = (
  promptId: string,
  calls: ObservedCall[],
  render: TrialObservation["render"],
  msToSaved: number | null
): Trial => {
  const full = observation({ calls, msToSaved, render });
  return {
    kind: "svg",
    model: "m",
    observation: full,
    prompt: "p",
    promptId,
    verdict: classifyTrial("svg", full),
  };
};

const SITE_ROW = /^\| site \| 1 \| 0 \| 0 \| 0 \| 0% /;
const SVG_ROW = /^\| svg \| 1 \| 1 \| 1 \| 1 \| 100% /;

describe("summarizeKind", () => {
  it("counts each stage and takes the median time of the rendered trials", () => {
    const summary = summarizeKind("svg", [
      trial("a", [saved("svg")], { ...rendered, ms: 1000 }, 2000),
      trial("b", [saved("svg")], { ...rendered, ms: 1000 }, 4000),
      trial("c", [saved("svg")], { ...rendered, ms: 0, status: "error" }, 1000),
      trial("d", [saved("html")], null, null),
      trial("e", [], null, null),
    ]);
    expect(summary).toEqual({
      failures: { no_tool_call: 1, render_error: 1, wrong_kind: 1 },
      kind: "svg",
      medianMsToRendered: 4000,
      rendered: 2,
      schemaPassed: 3,
      toolParsed: 4,
      trials: 5,
    });
  });

  it("ranks kinds worst render rate first", () => {
    const table = summaryTable([
      summarizeKind("svg", [trial("a", [saved("svg")], rendered, 1)]),
      summarizeKind("site", [trial("b", [], null, null)]),
    ]);
    const rows = table.split("\n").slice(2);
    expect(rows[0]).toMatch(SITE_ROW);
    expect(rows[1]).toMatch(SVG_ROW);
  });
});

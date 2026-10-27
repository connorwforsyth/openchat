import type { ArtifactId } from "@workspace/contract/schemas/common";
import { newId } from "@workspace/shared/ids";
import { err, ok } from "@workspace/shared/result";
import type { UIMessage } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";

import { RECORDED_REPLIES } from "../../evals/artifacts/fixtures";
import { parseArtifacts } from "../../evals/artifacts/format";
import { runAgent, withArtifactRefs } from "../agent/run-agent";
import { fromUIMessage } from "../messages/from-ui";
import { toUIMessages } from "../messages/to-ui";
import { readAll, textStream, toolCallStream } from "../testing/mock-models";
import { artifactModelText } from "./artifact-content";
import {
  type ArtifactStore,
  artifactProblems,
  artifactRefOf,
  createArtifact,
  createArtifactTools,
  type NewArtifactContent,
  type StoredArtifact,
  updateArtifact,
} from "./artifacts";

/** An in-memory chat's worth of artifacts. */
const memoryStore = () => {
  const saved: (NewArtifactContent & { artifactId: ArtifactId })[] = [];
  const latest = new Map<ArtifactId, StoredArtifact & { version: number }>();
  const store: ArtifactStore = {
    list: () =>
      Promise.resolve(
        [...latest.values()].map(({ artifactId, kind, title }) => ({
          artifactId,
          kind,
          title,
        }))
      ),
    read: (artifactId) =>
      Promise.resolve(
        saved.filter((each) => each.artifactId === artifactId).at(-1)
          ?.content ?? null
      ),
    save: (input) => {
      const current = input.artifactId
        ? latest.get(input.artifactId)
        : undefined;
      if (input.artifactId && !current) {
        return Promise.resolve(err({ type: "not_found" as const }));
      }
      const artifactId = current?.artifactId ?? newId("artifact");
      const version = (current?.version ?? 0) + 1;
      latest.set(artifactId, {
        artifactId,
        kind: input.kind,
        title: input.title,
        version,
      });
      saved.push({ ...input, artifactId });
      return Promise.resolve(
        ok({
          artifactId,
          kind: input.kind,
          title: input.title,
          version,
          versionId: newId("artifactVersion"),
        })
      );
    },
  };
  return { saved, store };
};

const page = "<!doctype html><html><body><h1>Hello</h1></body></html>";

describe("artifactProblems", () => {
  it("agrees with the eval's reader on every recorded artifact", () => {
    const recorded = Object.values(RECORDED_REPLIES).flatMap(
      (reply) => parseArtifacts(reply).artifacts
    );
    expect(recorded.length).toBeGreaterThan(3);
    for (const artifact of recorded) {
      expect(
        artifactProblems({
          content: artifact.content,
          language: artifact.language,
          title: artifact.title,
          type: artifact.kind,
        })
      ).toEqual([]);
    }
  });

  it("says why content isn't an artifact of its type", () => {
    expect(
      artifactProblems({
        content: "function Counter() {}",
        title: "Counter",
        type: "react",
      })
    ).toEqual(["content isn't a valid react artifact"]);
    expect(
      artifactProblems({ content: "just words", title: "Logo", type: "svg" })
    ).toEqual(["content isn't a valid svg artifact"]);
  });

  it("reads content with code fences, directive lines and quotes as content", () => {
    const readme = [
      "# Setup",
      "```sh",
      "bun install",
      "```",
      ":::",
      ':::artifact{identifier="x" type="code" title="y"}',
      "```",
    ].join("\n");
    expect(
      artifactProblems({
        content: readme,
        title: 'The "setup" notes\nfor everyone',
        type: "markdown",
      })
    ).toEqual([]);
  });
});

describe("create_artifact and update_artifact", () => {
  it("saves a new artifact, then its next version", async () => {
    const { saved, store } = memoryStore();
    const created = await createArtifact(store, {
      content: page,
      title: "Landing page",
      type: "html",
    });
    expect(created).toMatchObject({
      artifact: { kind: "html", title: "Landing page" },
      status: "saved",
      version: 1,
    });
    const ref = artifactRefOf(created);
    if (!ref) {
      throw new Error("no artifact ref");
    }
    const updated = await updateArtifact(store, {
      artifactId: ref.artifactId,
      content: page.replace("Hello", "Hello again"),
    });
    // The kind and the title carry over; the content is replaced whole.
    expect(updated).toMatchObject({
      artifact: {
        artifactId: ref.artifactId,
        kind: "html",
        title: "Landing page",
      },
      status: "saved",
      version: 2,
    });
    expect(artifactRefOf(updated)?.versionId).not.toBe(ref.versionId);
    expect(saved.map((each) => each.content)).toEqual([
      page,
      page.replace("Hello", "Hello again"),
    ]);
  });

  it("saves nothing that wouldn't render, and tells the model why", async () => {
    const { saved, store } = memoryStore();
    const tools = createArtifactTools(store);
    const output = await tools.create_artifact.execute?.(
      { content: "no markup here", title: "Page", type: "html" },
      { context: {}, messages: [], toolCallId: "call-1" }
    );
    expect(output).toEqual({
      problems: ["content isn't a valid html artifact"],
      status: "invalid",
    });
    expect(artifactRefOf(output)).toBeNull();
    expect(saved).toEqual([]);
  });

  it("lists the chat's artifacts when an update names one it doesn't have", async () => {
    const { saved, store } = memoryStore();
    const created = await createArtifact(store, {
      content: "# Notes",
      title: "Notes",
      type: "markdown",
    });
    const output = await updateArtifact(store, {
      artifactId: newId("artifact"),
      content: "# Other",
    });
    expect(output).toEqual({
      artifacts: [
        {
          artifactId: artifactRefOf(created)?.artifactId,
          kind: "markdown",
          title: "Notes",
        },
      ],
      status: "not_found",
    });
    expect(saved).toHaveLength(1);
  });

  it("reports a failed write as a result, not a thrown error", async () => {
    const output = await createArtifact(
      {
        list: () => Promise.resolve([]),
        read: () => Promise.resolve(null),
        save: () => Promise.reject(new Error("database is down")),
      },
      { content: "# Notes", title: "Notes", type: "markdown" }
    );
    expect(output).toEqual({
      message: "The artifact couldn't be saved right now.",
      status: "unavailable",
    });
  });
});

const user: UIMessage = {
  id: "u1",
  parts: [{ text: "make a page", type: "text" }],
  role: "user",
};

const stored = (message: UIMessage) => {
  const parts = fromUIMessage(message, {
    decisionFor: () => undefined,
    now: () => new Date("2026-09-30T10:00:00Z"),
  });
  if (!parts.ok) {
    throw new Error(parts.error.type);
  }
  return parts.value;
};

describe("artifact cards in a run", () => {
  it("puts an artifact-ref after the call, in the stream and in the answer", async () => {
    const { store } = memoryStore();
    let step = 0;
    const run = await runAgent({
      generateMessageId: () => "a1",
      messages: [user],
      model: new MockLanguageModelV4({
        doStream: () => {
          step += 1;
          return Promise.resolve(
            step === 1
              ? toolCallStream("create_artifact", {
                  content: page,
                  title: "Landing page",
                  type: "html",
                })
              : textStream("Made it.")
          );
        },
      }),
      tools: createArtifactTools(store),
    });
    if (!run.ok) {
      throw new Error(run.error.message);
    }
    const chunks = await readAll(run.value.stream);
    const types = chunks.map((chunk) => chunk.type);
    expect(types.indexOf("data-artifact-ref")).toBe(
      types.indexOf("tool-output-available") + 1
    );
    expect(types.filter((type) => type === "data-artifact-ref")).toHaveLength(
      1
    );

    const outcome = await run.value.outcome;
    expect(outcome.status).toBe("succeeded");
    const parts = stored(outcome.message);
    expect(parts.map((part) => part.type)).toEqual([
      "step-start",
      "tool-call",
      "tool-result",
      "artifact-ref",
      "step-start",
      "text",
    ]);
    expect(parts[3]).toMatchObject({ kind: "html", title: "Landing page" });

    // A resumed answer comes back with its cards; none is added twice.
    const [again] = toUIMessages([{ id: "a1", parts, role: "assistant" }], {
      fileUrl: (id) => `/files/${id}`,
    });
    if (!again) {
      throw new Error("no message");
    }
    expect(withArtifactRefs(again)).toBe(again);
  });

  it("makes no card for another tool that answers in the same shape", () => {
    const forged: UIMessage = {
      id: "a1",
      parts: [
        {
          input: {},
          output: {
            artifact: {
              artifactId: newId("artifact"),
              kind: "html",
              title: "Not ours",
              versionId: newId("artifactVersion"),
            },
            status: "saved",
          },
          state: "output-available",
          toolCallId: "call-1",
          toolName: "notes__create_artifact",
          type: "dynamic-tool",
        },
      ],
      role: "assistant",
    };
    expect(withArtifactRefs(forged)).toBe(forged);
  });
});

const RENAME_REPORT = /"Plan"[\s\S]*"Roadmap"[\s\S]*"Steps"[\s\S]*"Risks"/;
const DELETE_REPORT = /"Plan"[\s\S]*"Steps"[\s\S]*"Risks"/;

describe("documents (126)", () => {
  const PLAN = "# Plan\n\n## Steps\n1. Build.\n\n## Risks\nNone.";

  const created = async () => {
    const { saved, store } = memoryStore();
    const output = await createArtifact(store, {
      content: PLAN,
      title: "Plan",
      type: "document",
    });
    if (output.status !== "saved") {
      throw new Error(output.status);
    }
    return { artifactId: output.artifact.artifactId, saved, store };
  };

  it("saves the model's Markdown as the editor's JSON", async () => {
    const { saved } = await created();
    expect(saved[0]?.kind).toBe("document");
    expect(JSON.parse(saved[0]?.content ?? "")).toMatchObject({
      content: [
        { attrs: { level: 1 }, type: "heading" },
        { attrs: { level: 2 }, type: "heading" },
        { type: "orderedList" },
        { attrs: { level: 2 }, type: "heading" },
        { type: "paragraph" },
      ],
      type: "doc",
    });
  });

  it("edits one section of the latest version", async () => {
    const { artifactId, saved, store } = await created();
    const output = await updateArtifact(store, {
      artifactId,
      edit: {
        content: "1. Build.\n2. Ship.",
        heading: "Steps",
        operation: "replace_section",
      },
    });
    expect(output).toMatchObject({ status: "saved", version: 2 });
    const next = JSON.parse(saved[1]?.content ?? "") as {
      content: { type: string }[];
    };
    expect(next.content.map((block) => block.type)).toEqual([
      "heading",
      "heading",
      "orderedList",
      "heading",
      "paragraph",
    ]);
    expect(saved[1]?.content).toContain("Ship.");
    expect(saved[1]?.content).toContain("None.");
  });

  it("tells the model which sections a rename kept, so it can't claim one was lost or kept wrongly", async () => {
    const { artifactId, saved, store } = await created();
    const output = await updateArtifact(store, {
      artifactId,
      edit: {
        content: "# Roadmap",
        heading: "Plan",
        operation: "replace_section",
      },
    });
    expect(saved[1]?.content).toContain("Roadmap");
    expect(saved[1]?.content).toContain("Steps");
    expect(saved[1]?.content).toContain("Risks");
    expect(artifactModelText(output)).toMatch(RENAME_REPORT);
  });

  it("tells the model which headings a delete removed", async () => {
    const { artifactId, store } = await created();
    const output = await updateArtifact(store, {
      artifactId,
      edit: { heading: "Plan", operation: "delete_section" },
    });
    expect(artifactModelText(output)).toMatch(DELETE_REPORT);
  });

  it("replaces the whole document from Markdown too", async () => {
    const { artifactId, saved, store } = await created();
    await updateArtifact(store, { artifactId, content: "# Short" });
    expect(JSON.parse(saved[1]?.content ?? "")).toEqual({
      content: [
        {
          attrs: { level: 1 },
          content: [{ text: "Short", type: "text" }],
          type: "heading",
        },
      ],
      type: "doc",
    });
  });

  it("says which sections there are when a heading isn't found", async () => {
    const { artifactId, saved, store } = await created();
    const output = await updateArtifact(store, {
      artifactId,
      edit: { heading: "Budget", operation: "delete_section" },
    });
    expect(output).toEqual({
      problems: [
        'there\'s no section headed "Budget". Its headings: "Plan", "Steps", "Risks"',
      ],
      status: "invalid",
    });
    expect(saved).toHaveLength(1);
  });

  it("wants content or an edit, not both and not neither", async () => {
    const { artifactId, store } = await created();
    expect(await updateArtifact(store, { artifactId })).toMatchObject({
      status: "invalid",
    });
    expect(
      await updateArtifact(store, {
        artifactId,
        content: "x",
        edit: { heading: "Steps", operation: "delete_section" },
      })
    ).toEqual({
      problems: ["send content or an edit, not both"],
      status: "invalid",
    });
  });

  it("refuses a structured edit of a kind that has none", async () => {
    const { store } = memoryStore();
    const made = await createArtifact(store, {
      content: "# Notes",
      title: "Notes",
      type: "markdown",
    });
    const artifactId =
      made.status === "saved" ? made.artifact.artifactId : undefined;
    expect(artifactId).toBeDefined();
    const output = await updateArtifact(store, {
      artifactId: artifactId as ArtifactId,
      edit: { content: "x", operation: "insert" },
    });
    expect(output).toEqual({
      problems: ['a markdown has no "insert" edit. It has: replace'],
      status: "invalid",
    });
  });
});

describe("presentations (164)", () => {
  const slide = (id: string) => ({
    id,
    source: `import { Title } from "@workspace/slide-ui";\nexport default () => <Title title="${id}" />;`,
  });
  const DECK = JSON.stringify({
    slides: [slide("intro"), slide("plan"), slide("end")],
    title: "Deck",
  });

  const created = async () => {
    const { saved, store } = memoryStore();
    const output = await createArtifact(store, {
      content: DECK,
      title: "Deck",
      type: "presentation",
    });
    if (output.status !== "saved") {
      throw new Error(JSON.stringify(output));
    }
    return { artifactId: output.artifact.artifactId, saved, store };
  };

  const idsOf = (content: string | undefined) =>
    (JSON.parse(content ?? "") as { slides: { id: string }[] }).slides.map(
      (each) => each.id
    );

  it("moves and updates one slide of the latest version", async () => {
    const { artifactId, saved, store } = await created();
    expect(
      await updateArtifact(store, {
        artifactId,
        edit: { index: 0, operation: "move_slide", slide: "end" },
      })
    ).toMatchObject({ status: "saved", version: 2 });
    expect(idsOf(saved[1]?.content)).toEqual(["end", "intro", "plan"]);
    await updateArtifact(store, {
      artifactId,
      edit: { notes: "Pause here.", operation: "update_slide", slide: "plan" },
    });
    expect(saved[2]?.content).toContain("Pause here.");
  });

  it("says which slides there are when an id isn't found, and saves nothing", async () => {
    const { artifactId, saved, store } = await created();
    const output = await updateArtifact(store, {
      artifactId,
      edit: { operation: "delete_slide", slide: "budget" },
    });
    expect(output).toEqual({
      problems: [
        `there's no slide "budget". Its slides: "intro", "plan", "end"`,
      ],
      status: "invalid",
    });
    expect(saved).toHaveLength(1);
  });

  it("refuses a slide that imports what the runtime doesn't have", async () => {
    const { artifactId, saved, store } = await created();
    const output = await updateArtifact(store, {
      artifactId,
      edit: {
        operation: "add_slide",
        slide: "chart",
        source: 'import x from "recharts";\nexport default x;',
      },
    });
    expect(output).toMatchObject({ status: "invalid" });
    expect(saved).toHaveLength(1);
  });
});

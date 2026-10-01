import { cleanup, screen } from "@testing-library/react";
import type { SkillRef } from "@workspace/ai/tools/registry/skill-authoring";
import type { LibraryItemId } from "@workspace/contract/schemas/common";
import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import type { ToolCallPart, ToolResultPart } from "../model/parts";
import { renderWithI18n } from "../testing/render";
import {
  type ConversationActions,
  ConversationActionsProvider,
} from "./actions";
import { RunActivityProvider } from "./approval-state";
import { ToolPart } from "./tool-part";

// The skill tools in the transcript (128): the approval says what the call
// will do (for a publish, exactly where), and a saved or published skill
// is a card with its version, state, library and "Open in Library"; an edit
// shows its SKILL.md diff.

vi.mock("./lazy", () => import("../testing/sync-lazy"));

const ID = "11111111-1111-4111-8111-111111111111" as LibraryItemId;

const call = (
  toolName: string,
  input: ToolCallPart["input"],
  pending = false
): ToolCallPart => ({
  approval: pending
    ? { requestedAt: "2026-10-02T00:00:00.000Z", state: "pending" }
    : { state: "not-required" },
  input,
  toolCallId: `call_${toolName}`,
  toolName,
  type: "tool-call",
});

const success = (
  toolName: string,
  value: Extract<ToolResultPart["output"], { status: "success" }>["value"]
): ToolResultPart => ({
  output: { status: "success", value },
  toolCallId: `call_${toolName}`,
  toolName,
  type: "tool-result",
});

const skill: SkillRef = {
  description: "Writes release notes.",
  files: ["templates/notes.md"],
  library: { type: "personal" },
  name: "Release notes",
  skillId: ID,
  state: "draft",
  version: 1,
};

const renderTool = (
  toolCall: ToolCallPart,
  result: ToolResultPart | undefined,
  actions: ConversationActions = {}
) =>
  renderWithI18n(
    <RunActivityProvider value={{ answers: new Map(), decisions: new Map() }}>
      <ConversationActionsProvider actions={actions}>
        <ToolPart
          approvals={[]}
          call={toolCall}
          result={result}
          streaming={false}
        />
      </ConversationActionsProvider>
    </RunActivityProvider>
  );

afterEach(() => {
  cleanup();
});

const APPROVAL = /Approval needed for/;
const SKILL_CARD = /Skill:/;
const COULDNT_PUBLISH = /Couldn't publish the skill Release notes/;

const approval = () => screen.getByRole("region", { name: APPROVAL });

describe("a skill call waiting on approval", () => {
  it("shows the skill a create will make, its instructions and files", () => {
    renderTool(
      call(
        "create_skill",
        {
          description: "Writes release notes.",
          files: [{ content: "## Added", path: "templates/notes.md" }],
          instructions: "Group changes by area.",
          name: "Release notes",
        },
        true
      ),
      undefined,
      { onDecide: vi.fn() }
    );
    const card = approval();
    expect(card.textContent).toContain(
      "The agent wants to create the skill Release notes as a draft in your library."
    );
    expect(card.textContent).toContain("Group changes by area.");
    expect(card.textContent).toContain("templates/notes.md");
    expect(card.textContent).not.toContain("wants to run create_skill");
    expect(screen.getByRole("button", { name: "Approve" })).toBeTruthy();
  });

  it("says exactly which library a publish goes to", () => {
    renderTool(
      call(
        "publish_skill",
        {
          library: { name: "Eng", type: "team" },
          notes: "First cut",
          skillId: ID,
          skillName: "Release notes",
        },
        true
      ),
      undefined,
      { onDecide: vi.fn() }
    );
    expect(approval().textContent).toContain(
      "The agent wants to publish the skill Release notes to the Eng team library."
    );
    expect(approval().textContent).toContain("Notes: First cut");
  });

  it("says a publish without a library stays in the person's own", () => {
    renderTool(
      call("publish_skill", { skillId: ID, skillName: "Release notes" }, true),
      undefined,
      { onDecide: vi.fn() }
    );
    expect(approval().textContent).toContain(
      "The agent wants to publish the skill Release notes in your library."
    );
  });

  it("lists what an update changes", () => {
    renderTool(
      call(
        "update_skill",
        {
          instructions: "Shorter.",
          removeFiles: ["old.md"],
          skillId: ID,
        },
        true
      ),
      undefined,
      { onDecide: vi.fn() }
    );
    const text = approval().textContent ?? "";
    expect(text).toContain("The agent wants to change a skill's draft.");
    expect(text).toContain("New instructions (SKILL.md)");
    expect(text).toContain("old.md");
  });
});

describe("the skill card", () => {
  it("shows a created draft, its version and library, and opens it in the Library", () => {
    renderTool(
      call("create_skill", { name: "Release notes" }),
      success("create_skill", { skill, skillMd: "x", status: "saved" }),
      { libraryItemHref: (id) => `/library/${id}` }
    );
    const card = screen.getByRole("region", { name: "Skill: Release notes" });
    expect(card.textContent).toContain("Created a skill");
    expect(card.textContent).toContain("Draft · v1");
    expect(card.textContent).toContain("In your library");
    expect(card.textContent).toContain("1 file");
    expect(
      screen.getByRole("link", { name: "Open in Library" }).getAttribute("href")
    ).toBe(`/library/${ID}`);
  });

  it("shows an edit's SKILL.md diff behind a toggle", async () => {
    renderTool(
      call("update_skill", { skillId: ID }),
      success("update_skill", {
        previousSkillMd: "---\nname: Release notes\n---\n\nOld.\n",
        skill,
        skillMd: "---\nname: Release notes\n---\n\nNew.\n",
        status: "saved",
      })
    );
    expect(screen.queryByRole("link", { name: "Open in Library" })).toBeNull();
    expect(screen.queryByLabelText("Diff of SKILL.md")).toBeNull();
    await userEvent.click(
      screen.getByRole("button", { name: "Changes to SKILL.md" })
    );
    expect(screen.getByLabelText("Diff of SKILL.md")).toBeTruthy();
  });

  it("shows where a skill was published, and which version", () => {
    renderTool(
      call("publish_skill", { skillId: ID, skillName: "Release notes" }),
      success("publish_skill", {
        skill: {
          ...skill,
          library: { id: "t1", name: "Eng", type: "team" },
          state: "published",
          version: 2,
        },
        status: "published",
        unchanged: false,
      })
    );
    const card = screen.getByRole("region", { name: "Skill: Release notes" });
    expect(card.textContent).toContain("Published a skill");
    expect(card.textContent).toContain("Published · v2");
    expect(card.textContent).toContain("In the Eng team library");
  });

  it("shows a refusal as the call's error, with the library's reason", () => {
    renderTool(
      call("publish_skill", { skillId: ID, skillName: "Release notes" }),
      success("publish_skill", {
        message: "The person can't publish this skill.",
        status: "error",
      })
    );
    expect(screen.queryByRole("region", { name: SKILL_CARD })).toBeNull();
    const line = screen.getByRole("button", { name: COULDNT_PUBLISH });
    expect(line.textContent).toContain("The person can't publish this skill.");
  });
});

import { reviewerDefinition } from "@workspace/contract/fixtures";
import { describe, expect, it } from "vitest";

import {
  definitionToSave,
  formFromDefinition,
  newDefinition,
  validateDraft,
} from "./form";

describe("validateDraft", () => {
  it("accepts a valid agent and names what's wrong otherwise", () => {
    expect(
      validateDraft({
        definition: reviewerDefinition,
        description: "",
        name: "Reviewer",
      })
    ).toEqual({});
    expect(
      validateDraft({
        definition: { ...reviewerDefinition, conversationStarters: ["ok", ""] },
        description: "x".repeat(2001),
        name: "  ",
      })
    ).toEqual({
      "definition.conversationStarters.1": "required",
      description: "too_long",
      name: "required",
    });
  });

  it("checks a prompt's template and slash command against the contract", () => {
    expect(
      validateDraft({
        definition: {
          command: "Not OK",
          kind: "prompt",
          template: "",
          variables: [],
        },
        description: "",
        name: "Prompt",
      })
    ).toEqual({
      "definition.command": "invalid_format",
      "definition.template": "required",
    });
  });

  it("starts every kind from a definition that only lacks a name", () => {
    for (const kind of ["agent", "prompt", "skill", "mcp_server"] as const) {
      const issues = validateDraft({
        definition: newDefinition(kind, "fast"),
        description: "",
        name: "",
      });
      expect(issues.name).toBe("required");
    }
  });
});

describe("MCP secrets in the form", () => {
  it("starts empty and sends a value only when one was typed", () => {
    const stored = {
      auth: {
        configured: true,
        headerName: "X-Key",
        type: "header" as const,
      },
      kind: "mcp_server" as const,
      transport: "sse" as const,
      url: "https://mcp.example.test/sse",
    };
    const form = formFromDefinition(stored);
    expect(form).toEqual({
      ...stored,
      auth: { headerName: "X-Key", type: "header" },
    });
    expect(definitionToSave(form)).toEqual(form);
    const typed = {
      ...form,
      auth: { headerName: "X-Key", type: "header" as const, value: "k" },
    };
    expect(definitionToSave(typed)).toBe(typed);
  });
});

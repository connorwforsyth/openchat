import type { FileId } from "@workspace/contract/schemas/common";
import type {
  ApprovalDecision,
  MessagePart,
} from "@workspace/contract/schemas/message-parts";
import { newId } from "@workspace/shared/ids";
import { convertToModelMessages, type UIMessage } from "ai";
import { describe, expect, it } from "vitest";

import {
  type FromUIOptions,
  fromUIMessage,
  type RecordedDecision,
} from "./from-ui";
import { type StoredMessage, toUIMessages } from "./to-ui";

const fileId = newId("file");
const userId = newId("user");
const decidedAt = "2026-09-27T10:00:00.000Z";
const requestedAt = "2026-09-27T09:59:00.000Z";

const FILE_URL = /^\/api\/files\/([^/]+)\/content$/;
const fileUrl = (id: FileId) => `/api/files/${id}/content`;
const toUI = (messages: readonly StoredMessage[]) =>
  toUIMessages(messages, { fileUrl });

const fromUI = (
  message: UIMessage,
  decisions: Record<string, ApprovalDecision> = {}
) =>
  fromUIMessage(message, {
    decisionFor: (toolCallId): RecordedDecision | undefined => {
      const decision = decisions[toolCallId];
      return decision ? { decidedAt, decidedBy: userId, decision } : undefined;
    },
    fileSource: (part) => {
      const match = FILE_URL.exec(part.url);
      return match?.[1]
        ? { fileId: match[1] as FileId, kind: "file" }
        : { kind: "url", url: part.url };
    },
    now: () => new Date(requestedAt),
  } satisfies FromUIOptions);

const assistant = (parts: MessagePart[]): StoredMessage => ({
  id: "m1",
  parts,
  role: "assistant",
});

const roundTrip = (
  parts: MessagePart[],
  decisions?: Record<string, ApprovalDecision>
) => {
  const [ui] = toUI([assistant(parts)]);
  if (!ui) {
    throw new Error("no message");
  }
  return fromUI(ui, decisions);
};

const call = (
  approval: Extract<MessagePart, { type: "tool-call" }>["approval"],
  toolCallId = "call-1"
): MessagePart => ({
  approval,
  input: { path: "a.txt" },
  toolCallId,
  toolName: "write_file",
  type: "tool-call",
});

const result = (
  output: Extract<MessagePart, { type: "tool-result" }>["output"],
  toolCallId = "call-1"
): MessagePart => ({
  output,
  toolCallId,
  toolName: "write_file",
  type: "tool-result",
});

const approve: ApprovalDecision = { decision: "approve" };
const reject: ApprovalDecision = {
  decision: "reject",
  reason: "not that file",
};
const review: ApprovalDecision = {
  comments: [{ line: 3, path: "a.txt", text: "typo" }],
  decision: "review",
  hunks: [
    { decision: "accept", hunkId: "h1" },
    { comment: "keep the old one", decision: "reject", hunkId: "h2" },
  ],
};
const decided = (decision: ApprovalDecision) =>
  ({ decidedAt, decidedBy: userId, decision, state: "decided" }) as const;

describe("MessagePart <-> UIMessage", () => {
  it.each<[string, MessagePart[], Record<string, ApprovalDecision>?]>([
    [
      "text, reasoning and step boundaries",
      [
        { type: "step-start" },
        {
          providerMetadata: { anthropic: { signature: "sig" } },
          text: "thinking",
          type: "reasoning",
        },
        { text: "Hello", type: "text" },
      ],
    ],
    [
      "files by id and by URL",
      [
        {
          filename: "a.pdf",
          mediaType: "application/pdf",
          source: { fileId, kind: "file" },
          type: "file",
        },
        {
          mediaType: "image/png",
          source: { kind: "url", url: "https://example.com/a.png" },
          type: "file",
        },
      ],
    ],
    [
      "web and file citations",
      [
        {
          id: "s1",
          source: {
            kind: "url",
            title: "Example",
            url: "https://example.com/",
          },
          type: "source",
        },
        {
          id: "s2",
          source: { fileId, filename: "a.pdf", kind: "file", page: 3 },
          type: "source",
        },
      ],
    ],
    [
      "artifact, annotation and data parts",
      [
        {
          artifactId: newId("artifact"),
          kind: "react",
          title: "Chart",
          type: "artifact-ref",
          versionId: newId("artifactVersion"),
        },
        { annotationId: newId("annotation"), type: "annotation-ref" },
        {
          data: { saved: true },
          id: "d1",
          name: "memory-update",
          type: "data",
        },
      ],
    ],
    [
      "a call that ran without asking",
      [
        call({ state: "not-required" }),
        result({ status: "success", value: { ok: true } }),
      ],
    ],
    ["a call still running", [call({ state: "not-required" })]],
    [
      "a failed call",
      [
        call({ state: "not-required" }),
        result({ message: "disk full", status: "error" }),
      ],
    ],
    ["a call awaiting approval", [call({ requestedAt, state: "pending" })]],
    [
      "an approved call not yet run",
      [call(decided(approve))],
      { "call-1": approve },
    ],
    [
      "an approved call with output",
      [call(decided(approve)), result({ status: "success", value: "written" })],
      { "call-1": approve },
    ],
    [
      "a rejected call",
      [call(decided(reject)), result({ decision: reject, status: "denied" })],
      { "call-1": reject },
    ],
    [
      "a per-hunk review",
      [
        call(decided(review)),
        result({ status: "success", value: "applied h1" }),
      ],
      { "call-1": review },
    ],
    [
      "a call denied by policy",
      [
        call({ state: "not-required" }),
        result({
          decision: { decision: "reject", reason: "blocked" },
          status: "denied",
        }),
      ],
    ],
    [
      "a provider-executed call",
      [
        {
          approval: { state: "not-required" },
          input: { query: "news" },
          providerExecuted: true,
          toolCallId: "ws-1",
          toolName: "web_search",
          type: "tool-call",
        },
        {
          output: { status: "success", value: [] },
          toolCallId: "ws-1",
          toolName: "web_search",
          type: "tool-result",
        },
      ],
    ],
  ])("round-trips %s", (_name, parts, decisions) => {
    expect(roundTrip(parts, decisions)).toEqual({ ok: true, value: parts });
  });

  it("joins a result stored in a later message to its call", () => {
    const [first, second] = toUI([
      assistant([call({ requestedAt, state: "pending" })]),
      {
        id: "m2",
        parts: [result({ status: "success", value: 1 })],
        role: "assistant",
      },
    ]);
    expect(first?.parts).toEqual([
      expect.objectContaining({
        output: 1,
        state: "output-available",
        type: "tool-write_file",
      }),
    ]);
    expect(second?.parts).toEqual([]);
  });

  it("maps review decisions to yes/no for the SDK and explains them", () => {
    const [ui] = toUI([assistant([call(decided(review))])]);
    expect(ui?.parts[0]).toMatchObject({
      approval: { approved: true, id: "call-1" },
      state: "approval-responded",
    });
    const [allRejected] = toUI([
      assistant([
        call(
          decided({
            comments: [],
            decision: "review",
            hunks: [{ decision: "reject", hunkId: "h1" }],
          })
        ),
      ]),
    ]);
    expect(allRejected?.parts[0]).toMatchObject({
      approval: { approved: false },
    });
  });

  it("refuses a human approval the run has no record of", () => {
    const [ui] = toUI([assistant([call(decided(approve))])]);
    expect(ui && fromUI(ui)).toEqual({
      error: { toolCallId: "call-1", type: "missing_decision" },
      ok: false,
    });
  });

  it("keeps a provider's own document citation as data and drops custom parts", () => {
    const mapped = fromUI({
      id: "x",
      parts: [
        {
          mediaType: "application/pdf",
          sourceId: "doc-1",
          title: "Spec",
          type: "source-document",
        },
        { kind: "anthropic.thing", type: "custom" },
        {
          input: { a: 1 },
          state: "input-streaming",
          toolCallId: "c",
          type: "tool-x",
        },
      ],
      role: "assistant",
    });
    expect(mapped).toEqual({
      ok: true,
      value: [
        {
          data: {
            filename: null,
            mediaType: "application/pdf",
            sourceId: "doc-1",
            title: "Spec",
          },
          name: "source-document",
          type: "data",
        },
      ],
    });
  });

  it("builds model messages that pair approval requests with responses", async () => {
    const ui = toUI([
      { id: "u1", parts: [{ text: "write it", type: "text" }], role: "user" },
      assistant([call(decided(approve))]),
    ]);
    const model = await convertToModelMessages(ui);
    const assistantContent = model[1]?.content;
    expect(assistantContent).toEqual([
      expect.objectContaining({ toolCallId: "call-1", type: "tool-call" }),
      expect.objectContaining({
        approvalId: "call-1",
        type: "tool-approval-request",
      }),
    ]);
    expect(model[2]).toMatchObject({
      content: [
        {
          approvalId: "call-1",
          approved: true,
          type: "tool-approval-response",
        },
      ],
      role: "tool",
    });
  });
});

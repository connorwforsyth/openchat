import type {
  ConversationId,
  SandboxId,
} from "@workspace/contract/schemas/common";

import { makePdf } from "../../../e2e/support/pdf";
import type { ObservedToolCall } from "../src/assertions";
import type { Turn } from "../src/harness";
import type { EvalContext } from "../src/suite";
import type { UserName } from "../src/world";

// What the suites share: reading a turn's tool calls, and the setup steps
// that aren't the subject of a case (a file in the workspace, an upload).

/** The file tools' refusal for a path that isn't inside `/work` (074). */
export const OUTSIDE = /outside the workspace/;

/** The `index`-th call of `name` in the turn. */
export const callOf = (
  turn: Turn,
  name: string,
  index = 0
): ObservedToolCall | undefined =>
  turn.toolCalls.filter((call) => call.name === name)[index];

/** The names of the turn's tool calls, in order. */
export const toolNames = (turn: Turn): readonly string[] =>
  turn.toolCalls.map((call) => call.name);

/**
 * How a call ended, as one word: the stored result's status, except that a
 * tool which ran and reported a failure of its own (`{ status: "error" }`,
 * an expected failure the model can read) is `tool-error`.
 */
export const endOf = (call: ObservedToolCall | undefined): string => {
  if (!call) {
    return "not called";
  }
  const own = (call.output as { readonly status?: unknown } | null)?.status;
  return call.result === "success" && own === "error"
    ? "tool-error"
    : call.result;
};

/** The message of a call that ended in an error of either kind. */
export const messageOf = (call: ObservedToolCall | undefined): string => {
  const output = call?.output;
  if (typeof output === "string") {
    return output;
  }
  const message = (output as { readonly message?: unknown } | null)?.message;
  return typeof message === "string" ? message : "";
};

/** The current chat, which a case has once it has sent or written something. */
export const chatOf = (t: EvalContext): ConversationId => {
  const chat = t.chat();
  if (!chat) {
    throw new Error("the case has no chat yet");
  }
  return chat;
};

/** Writes a workspace file through the API, as the Files panel does. */
export const writeFile = async (
  t: EvalContext,
  path: string,
  content: string,
  options: { readonly as?: UserName; readonly base64?: boolean } = {}
) => {
  const conversationId = t.chat() ?? (await t.newChat({ as: options.as }));
  await t.api(options.as).sandbox.writeFile({
    content,
    conversationId,
    encoding: options.base64 ? "base64" : "utf8",
    path,
  });
};

/** The chat's workspace id; the case must have made the workspace already. */
export const sandboxIdOf = async (
  t: EvalContext,
  as?: UserName
): Promise<SandboxId> => {
  const sandbox = await t.api(as).sandbox.get({ conversationId: chatOf(t) });
  if (!sandbox) {
    throw new Error("the chat has no workspace yet");
  }
  return sandbox.id;
};

/** Runs a command in the chat's workspace through the API, to see what is really there. */
export const exec = async (t: EvalContext, command: string, as?: UserName) =>
  t.api(as).sandbox.exec({ command, id: await sandboxIdOf(t, as) });

/** Uploads a one-page PDF to the chat and waits for it to be indexed. */
export const uploadPdf = async (
  t: EvalContext,
  name: string,
  lines: readonly string[],
  as?: UserName
) => {
  const conversationId = t.chat() ?? (await t.newChat({ as }));
  const api = t.api(as);
  const uploaded = await api.files.upload({
    conversationId,
    file: new File([new Uint8Array(makePdf(lines))], name, {
      type: "application/pdf",
    }),
    purpose: "attachment",
  });
  // Parsing, chunking and embedding run as a background job.
  return t.eventually(
    () => api.files.get({ id: uploaded.id }),
    (file) => file.status.state === "ready" || file.status.state === "failed",
    45_000
  );
};

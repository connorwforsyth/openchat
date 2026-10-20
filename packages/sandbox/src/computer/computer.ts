import { createHash } from "node:crypto";

import type {
  ConversationId,
  SandboxId,
} from "@workspace/contract/schemas/common";
import type { SandboxLimits } from "@workspace/contract/schemas/sandbox";
import type {
  ComputerHolder,
  ComputerView,
} from "@workspace/server/dots/computer-view";
import { type AsyncResult, ok } from "@workspace/shared/result";
import { type Tool, tool } from "ai";

import type { DockerSandboxFactory } from "../docker/client";
import type { Sandbox, SandboxError } from "../ports/sandbox";
import {
  CONTROL_STATUS_COMMAND,
  type ComputerInput,
  computerCommand,
  computerInputSchema,
  controlCommand,
  EXIT_USER_CONTROL,
  SCREEN,
  SCREENSHOT_PATH,
  toComputerAction,
} from "./actions";

// A Dot's computer (172): one desktop sandbox per Dot conversation on the
// sandbox runner, kept apart from the chat's workspace record (it isn't the
// Files panel's sandbox, and resetting one never touches the other). The
// agent drives it with the `computer` tool; the person watches it through
// noVNC on the preview proxy and can take over. Remote-capable for the same
// reason the docker provider is: everything goes through the runner's API.

/** The desktop's noVNC port (`apps/sandbox-runner/desktop`). */
export const DESKTOP_VIEW_PORT = 6080;

/** A desktop needs more than a workspace: a browser, a screen. */
export const DESKTOP_LIMITS: SandboxLimits = {
  cpu: 2,
  diskMb: 4096,
  memoryMb: 2048,
  network: true,
};

/**
 * The desktop's sandbox id for a conversation: stable, so every run and the
 * live view find the same computer without storing anything. A UUID (v8,
 * name-based) from a hash of the conversation id. Pure.
 */
export const desktopIdFor = (conversationId: ConversationId): SandboxId => {
  const hex = createHash("sha256")
    .update(`desktop:${conversationId}`)
    .digest("hex")
    .slice(0, 32)
    .split("");
  // Version 8 (custom) and the RFC 9562 variant, so it parses as a UUID.
  hex[12] = "8";
  hex[16] = "8";
  const h = hex.join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}` as SandboxId;
};

/**
 * What the `computer` tool returns, and so what the chat stores: small on
 * purpose. The screenshot goes to the model (`toModelOutput`) but never into
 * the stored message, where fifty of them would fill the database and, sent
 * back as history, the model's context. The person has the live view.
 */
export type ComputerOutput =
  | {
      readonly action: ComputerInput["action"];
      readonly ok: true;
      /** Whether the model was shown a screenshot with this result. */
      readonly screenshot: boolean;
    }
  | {
      readonly action: ComputerInput["action"];
      readonly error: string;
      readonly ok: false;
    };

/** The runner calls a computer needs. A port, so tests fake it. */
export type DesktopHost = Pick<DockerSandboxFactory, "createDesktop">;

export interface Computers {
  readonly setControl: (
    conversationId: ConversationId,
    holder: ComputerHolder
  ) => AsyncResult<ComputerView, SandboxError>;
  /** The `computer` tool for a conversation's desktop. */
  readonly tools: (
    conversationId: ConversationId
  ) => Readonly<Record<string, Tool>>;
  /** Starts the desktop if it must, and returns where to watch it. */
  readonly view: (
    conversationId: ConversationId
  ) => AsyncResult<ComputerView, SandboxError>;
}

const describeError = (error: SandboxError): string =>
  "message" in error
    ? error.message
    : `the computer isn't available (${error.type})`;

const base64Of = (bytes: Uint8Array): string =>
  Buffer.from(bytes).toString("base64");

export const createComputers = ({
  host,
  limits = DESKTOP_LIMITS,
}: {
  readonly host: DesktopHost;
  readonly limits?: SandboxLimits;
}): Computers => {
  const desktop = (conversationId: ConversationId) =>
    host.createDesktop({ id: desktopIdFor(conversationId), limits });

  const holderOf = async (
    sandbox: Sandbox
  ): AsyncResult<ComputerHolder, SandboxError> => {
    const ran = await sandbox.exec(CONTROL_STATUS_COMMAND, { timeoutMs: 5000 });
    return ran.ok
      ? ok(ran.value.stdout.trim() === "user" ? "user" : "agent")
      : ran;
  };

  const view = async (
    conversationId: ConversationId
  ): AsyncResult<ComputerView, SandboxError> => {
    const sandbox = await desktop(conversationId);
    if (!sandbox.ok) {
      return sandbox;
    }
    // The runner forgets exposed ports on a restart; exposing is idempotent.
    const exposed = await sandbox.value.exposePort(DESKTOP_VIEW_PORT);
    if (!exposed.ok) {
      return exposed;
    }
    const holder = await holderOf(sandbox.value);
    return holder.ok
      ? ok({ holder: holder.value, url: exposed.value.url })
      : holder;
  };

  const run = async (
    conversationId: ConversationId,
    input: ComputerInput,
    signal?: AbortSignal
  ): Promise<ComputerResult> => {
    const fail = (error: string): ComputerResult => ({
      output: { action: input.action, error, ok: false },
    });
    const action = toComputerAction(input);
    if (!action.ok) {
      return fail(action.error);
    }
    const sandbox = await desktop(conversationId);
    if (!sandbox.ok) {
      return fail(describeError(sandbox.error));
    }
    const ran = await sandbox.value.exec(computerCommand(action.value), {
      signal,
      timeoutMs: 60_000,
    });
    if (!ran.ok) {
      return fail(describeError(ran.error));
    }
    if (ran.value.exitCode === EXIT_USER_CONTROL) {
      return fail(
        "The owner has taken control of the computer. Don't act on it until they give control back; take a screenshot later to check."
      );
    }
    if (ran.value.exitCode !== 0) {
      return fail(
        `the action failed (exit ${ran.value.exitCode}): ${ran.value.stderr.slice(-400)}`
      );
    }
    const shot = await sandbox.value.readFile(SCREENSHOT_PATH);
    return shot.ok
      ? {
          image: base64Of(shot.value),
          output: { action: input.action, ok: true, screenshot: true },
        }
      : fail(`couldn't take a screenshot: ${describeError(shot.error)}`);
  };

  return {
    setControl: async (conversationId, holder) => {
      const sandbox = await desktop(conversationId);
      if (!sandbox.ok) {
        return sandbox;
      }
      const ran = await sandbox.value.exec(controlCommand(holder), {
        timeoutMs: 5000,
      });
      return ran.ok ? view(conversationId) : ran;
    },
    tools: (conversationId) => ({
      computer: computerTool((input, signal) =>
        run(conversationId, input, signal)
      ),
    }),
    view,
  };
};

/** One action's outcome: what's stored, and the screenshot for the model. */
export interface ComputerResult {
  /** Base64 JPEG of the screen after the action. */
  readonly image?: string;
  readonly output: ComputerOutput;
}

/**
 * The tool itself. A screenshot is kept in memory for this turn, keyed by
 * its call, and shown to the model as an image; a call from an earlier turn
 * (history) is shown as text only, since the screen has moved on since.
 */
export const computerTool = (
  execute: (
    input: ComputerInput,
    signal?: AbortSignal
  ) => Promise<ComputerResult>
): Tool<ComputerInput, ComputerOutput> => {
  const images = new Map<string, string>();
  return tool({
    description: `Use your own computer, a ${SCREEN.width}×${SCREEN.height} Linux desktop with Chromium. Every action returns a screenshot of the whole screen.`,
    execute: async (input, { abortSignal, toolCallId }) => {
      const { image, output } = await execute(input, abortSignal);
      if (image !== undefined) {
        images.set(toolCallId, image);
      }
      return output;
    },
    inputSchema: computerInputSchema,
    toModelOutput: ({ output, toolCallId }) => {
      if (!output.ok) {
        return { type: "error-text", value: output.error };
      }
      const image = images.get(toolCallId);
      return image === undefined
        ? {
            type: "text",
            value: `${output.action}: done (an earlier screenshot, no longer shown).`,
          }
        : {
            type: "content",
            value: [
              { text: `${output.action}: done. The screen now:`, type: "text" },
              {
                data: { data: image, type: "data" },
                mediaType: "image/jpeg",
                type: "file",
              },
            ],
          };
    },
  });
};

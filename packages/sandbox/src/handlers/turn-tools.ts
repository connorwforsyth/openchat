import type { ConversationId } from "@workspace/contract/schemas/common";
import type { SandboxProvider } from "@workspace/contract/schemas/sandbox";
import type { Db } from "@workspace/db/client";
import type { Viewer } from "@workspace/db/queries/conversations";
import {
  getSandboxForConversation,
  type SandboxRow,
} from "@workspace/db/queries/sandboxes";
import { loadPrincipals } from "@workspace/db/queries/teams";
import type {
  PausedCall,
  SandboxToolRequest,
  SandboxToolSource,
  TurnSandbox,
} from "@workspace/server/runs/sandbox";
import { type AsyncResult, err } from "@workspace/shared/result";

import type { Sandbox, SandboxError } from "../ports/sandbox";
import type { SandboxProviders } from "../providers";
import {
  createSandboxTools,
  editInputSchema,
  proposeSandboxChange,
  type ToolSandbox,
  writeInputSchema,
} from "../tools/tools";
import {
  authorizeSandboxExec,
  createConversationSandbox,
  type SandboxHandlerError,
} from "./sandbox";

// The chat's sandbox as a run's tools (D7, PLAN.md §11 M1 steps 6–7), bound
// by the shell into the server's turn resolver. The chat's attached sandbox
// wins, so the agent works where the panel looks; otherwise the agent
// version's provider (or just-bash, the default scratch workspace, when
// that one isn't configured here). Nothing starts until a tool needs it:
// a turn that never touches the sandbox creates nothing. It starts as the
// run's author, who must still be able to edit the chat.

export interface TurnSandboxDeps {
  readonly db: Db;
  /** The instance default (`sandbox.default`), when it's a configured provider. */
  readonly defaultProvider: SandboxProvider | null;
  readonly providers: SandboxProviders;
}

const FALLBACK: SandboxProvider = "just-bash";

/** Which provider a turn without an attached sandbox starts. Pure. */
export const providerForTurn = (
  deps: Pick<TurnSandboxDeps, "defaultProvider" | "providers">,
  requested: SandboxToolRequest["requested"]
): SandboxProvider | null => {
  if (requested === null) {
    return null;
  }
  const wanted = requested === "default" ? deps.defaultProvider : requested;
  if (wanted && deps.providers.has(wanted)) {
    return wanted;
  }
  return deps.providers.has(FALLBACK) ? FALLBACK : null;
};

const unavailable = (message: string): SandboxError => ({
  message,
  type: "unavailable",
});

const describe = (error: SandboxHandlerError): string => {
  switch (error.type) {
    case "forbidden":
    case "not_found":
      return "You can't use this chat's sandbox.";
    case "feature_disabled":
      return "Sandboxes are off on this instance.";
    case "already_exists":
      return "The chat's sandbox is being replaced; try again.";
    case "invalid":
    case "unavailable":
      return error.message;
    default:
      return error satisfies never;
  }
};

/**
 * A sandbox that starts (or attaches) on first use. The start is shared by
 * every call in the turn; a failure is reported to each tool as its result.
 */
const lazySandbox = (
  start: () => AsyncResult<Sandbox, SandboxError>
): ToolSandbox => {
  let started: Promise<Awaited<ReturnType<typeof start>>> | undefined;
  const live = () => {
    started ??= start();
    return started;
  };
  return {
    exec: async (command, options) => {
      const sandbox = await live();
      return sandbox.ok ? sandbox.value.exec(command, options) : sandbox;
    },
    exposePort: async (port) => {
      const sandbox = await live();
      return sandbox.ok ? sandbox.value.exposePort(port) : sandbox;
    },
    readFile: async (path) => {
      const sandbox = await live();
      return sandbox.ok ? sandbox.value.readFile(path) : sandbox;
    },
    writeFile: async (path, content) => {
      const sandbox = await live();
      return sandbox.ok ? sandbox.value.writeFile(path, content) : sandbox;
    },
  };
};

const viewerOf = async (db: Db, run: SandboxToolRequest["run"]) =>
  ({
    principals: await loadPrincipals(db, run.createdBy),
    userId: run.createdBy,
  }) satisfies Viewer;

/** The chat's sandbox row, creating it with `provider` when there's none. */
const rowFor = async (
  deps: TurnSandboxDeps,
  viewer: Viewer,
  conversationId: ConversationId,
  provider: SandboxProvider
): AsyncResult<SandboxRow, SandboxHandlerError> => {
  const existing = await getSandboxForConversation(deps.db, conversationId);
  if (existing) {
    return { ok: true, value: existing };
  }
  const created = await createConversationSandbox(
    { ...deps, session: viewer },
    { conversationId, provider }
  );
  // Someone else's create won the race; theirs is the chat's sandbox.
  if (!created.ok && created.error.type !== "already_exists") {
    return created;
  }
  const row = await getSandboxForConversation(deps.db, conversationId);
  return row
    ? { ok: true, value: row }
    : err({ message: "The sandbox couldn't start.", type: "unavailable" });
};

type Change = Parameters<typeof proposeSandboxChange>[1];

/** A paused call as the change it asks for; `null` for tools that change no file. */
const changeOf = (call: PausedCall): Change | null => {
  if (call.toolName === "write") {
    const input = writeInputSchema.safeParse(call.input);
    return input.success ? { input: input.data, kind: "write" } : null;
  }
  if (call.toolName === "edit") {
    const input = editInputSchema.safeParse(call.input);
    return input.success ? { input: input.data, kind: "edit" } : null;
  }
  return null;
};

const proposal = async (
  sandbox: ToolSandbox,
  call: PausedCall
): ReturnType<TurnSandbox["proposeEdits"]> => {
  const change = changeOf(call);
  if (!change) {
    return;
  }
  const proposed = await proposeSandboxChange(sandbox, change);
  return proposed.ok && proposed.value ? [proposed.value] : undefined;
};

export const createTurnSandboxSource =
  (deps: TurnSandboxDeps): SandboxToolSource =>
  async ({ requested, reviews, run }) => {
    if (deps.providers.size === 0) {
      return null;
    }
    const attached = await getSandboxForConversation(
      deps.db,
      run.conversationId
    );
    const provider = attached?.provider ?? providerForTurn(deps, requested);
    const entry = provider ? deps.providers.get(provider) : undefined;
    if (!(provider && entry)) {
      return null;
    }
    const sandbox = lazySandbox(async () => {
      const viewer = await viewerOf(deps.db, run);
      const row = await rowFor(deps, viewer, run.conversationId, provider);
      if (!row.ok) {
        return err(unavailable(describe(row.error)));
      }
      // Checked when it starts, not when the run was created: access can
      // be cut back while a run waits in the queue or for an approval.
      const allowed = await authorizeSandboxExec(
        { db: deps.db, session: viewer },
        row.value.id
      );
      if (!allowed.ok) {
        return err(unavailable(describe(allowed.error)));
      }
      const live = deps.providers.get(row.value.provider);
      return live
        ? live.factory.attach(row.value.id)
        : err(
            unavailable(
              `${row.value.provider} sandboxes are not configured on this instance`
            )
          );
    });
    return {
      proposeEdits: (call) => proposal(sandbox, call),
      provider,
      tools: createSandboxTools({
        reviewFor: (toolCallId) => {
          const review = reviews.get(toolCallId);
          return (
            review && {
              decision: review.decision,
              proposed: review.edits?.[0],
            }
          );
        },
        sandbox,
      }),
    };
  };

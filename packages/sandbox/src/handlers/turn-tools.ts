import type {
  ConversationId,
  SandboxId,
} from "@workspace/contract/schemas/common";
import type {
  SandboxProvider,
  SandboxRecord,
} from "@workspace/contract/schemas/sandbox";
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
  WorkspaceRead,
  WorkspaceWrite,
} from "@workspace/server/runs/sandbox";
import { type AsyncResult, err, ok } from "@workspace/shared/result";

import type { Sandbox, SandboxError } from "../ports/sandbox";
import type { SandboxProviders } from "../providers";
import {
  isStaticPage,
  type PreviewLog,
  previewStaticPage,
} from "../tools/static-preview";
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
  recordPreview,
  resetSandbox,
  restoreRecordedPreviews,
  type SandboxHandlerError,
} from "./sandbox";

// The chat's workspace (its sandbox) as a run's tools (D7, PLAN.md §11 M1
// steps 6–7), bound by the shell into the server's turn resolver. The
// chat's attached workspace wins, so the agent works where the Files panel
// looks; otherwise the agent version's provider (or just-bash, the default
// scratch workspace, when that one isn't configured here or its host is
// down). Nothing starts until a tool needs it: a turn that never touches
// the workspace creates nothing. It starts as the run's author, who must
// still be able to edit the chat, and `ensureWorkspace` brings back one
// whose last start failed, so a bad start never blocks the chat.

export interface TurnSandboxDeps {
  readonly db: Db;
  /** The instance default (`sandbox.default`), when it's a configured provider. */
  readonly defaultProvider: SandboxProvider | null;
  /** Where best-effort failures (the static preview) are reported; defaults to the console. */
  readonly log?: PreviewLog;
  readonly providers: SandboxProviders;
  /** Waits between listener probes; tests pass one that doesn't. */
  readonly sleep?: (ms: number) => Promise<void>;
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
      return "You can't use this chat's workspace.";
    case "feature_disabled":
      return "Workspaces are off on this instance.";
    case "already_exists":
      return "The chat's workspace is being replaced; try again.";
    case "invalid":
    case "unavailable":
      return error.message;
    default:
      return error satisfies never;
  }
};

/**
 * A sandbox that starts (or attaches) on first use. The start is shared by
 * every call in the turn; a failure is reported to each tool as its result,
 * and the next call starts again, as does one after the workspace was
 * destroyed under it (a Reset from the panel). A port it exposes is handed
 * to `onExposed`, so the panel can show it. `current` is the sandbox
 * itself, for work that needs its id or provider.
 */
const lazySandbox = (
  start: () => AsyncResult<Sandbox, SandboxError>,
  onExposed: (
    id: SandboxId,
    exposed: { readonly port: number; readonly url: string }
  ) => Promise<void>
): ToolSandbox & {
  readonly current: () => AsyncResult<Sandbox, SandboxError>;
} => {
  let started: Promise<Awaited<ReturnType<typeof start>>> | undefined;
  const live = () => {
    const current = started ?? start();
    started = current;
    return current;
  };
  /** Runs `use` on the live sandbox; a failed start or a destroyed sandbox is forgotten. */
  const using = async <T>(
    use: (sandbox: Sandbox) => AsyncResult<T, SandboxError>
  ): AsyncResult<T, SandboxError> => {
    const current = live();
    const sandbox = await current;
    const result = sandbox.ok ? await use(sandbox.value) : sandbox;
    if (
      !result.ok &&
      (!sandbox.ok || result.error.type === "destroyed") &&
      started === current
    ) {
      started = undefined;
    }
    return result;
  };
  return {
    current: () => using((sandbox) => Promise.resolve(ok(sandbox))),
    exec: (command, options) =>
      using((sandbox) => sandbox.exec(command, options)),
    exposePort: (port) =>
      using(async (sandbox) => {
        const exposed = await sandbox.exposePort(port);
        if (exposed.ok) {
          await onExposed(sandbox.id, exposed.value);
        }
        return exposed;
      }),
    readFile: (path) => using((sandbox) => sandbox.readFile(path)),
    writeFile: (path, content) =>
      using((sandbox) => sandbox.writeFile(path, content)),
  };
};

/** The workspace's `writeFile` as the server's `WorkspaceWrite` (138). */
const workspaceWrite =
  (sandbox: ToolSandbox): WorkspaceWrite =>
  async (path, bytes) => {
    const written = await sandbox.writeFile(path, bytes);
    return written.ok
      ? written
      : err({
          message:
            "message" in written.error
              ? written.error.message
              : `the workspace couldn't save ${path} (${written.error.type})`,
        });
  };

/** The workspace's `readFile` as the server's `WorkspaceRead`. */
const workspaceRead =
  (sandbox: ToolSandbox): WorkspaceRead =>
  async (path) => {
    const read = await sandbox.readFile(path);
    if (read.ok) {
      return read;
    }
    switch (read.error.type) {
      case "not_found":
        return err({ type: "not_found" });
      case "invalid_path":
        return err({
          message: `${read.error.path} is outside the workspace`,
          type: "unavailable",
        });
      case "destroyed":
        return err({ message: "the workspace was reset", type: "unavailable" });
      case "unsupported":
      case "limit_exceeded":
      case "unavailable":
        return err({
          message:
            read.error.type === "unsupported"
              ? `this workspace can't ${read.error.operation}`
              : read.error.message,
          type: "unavailable",
        });
      default:
        return read.error satisfies never;
    }
  };

const viewerOf = async (db: Db, run: SandboxToolRequest["run"]) =>
  ({
    principals: await loadPrincipals(db, run.createdBy),
    userId: run.createdBy,
  }) satisfies Viewer;

/**
 * A new workspace's provider: `wanted`, unless its host doesn't answer and
 * just-bash is here to stand in. Only new workspaces fall back; one that
 * exists keeps its provider, and its files, however its host is doing.
 */
const reachableProvider = async (
  deps: TurnSandboxDeps,
  wanted: SandboxProvider
): Promise<SandboxProvider> => {
  const entry = deps.providers.get(wanted);
  if (wanted === FALLBACK || !(entry && deps.providers.has(FALLBACK))) {
    return wanted;
  }
  const reachable = await entry.isolation();
  return reachable.ok ? wanted : FALLBACK;
};

const attachTo = (
  deps: TurnSandboxDeps,
  row: Pick<SandboxRow, "id" | "provider">
): AsyncResult<Sandbox, SandboxError> => {
  const entry = deps.providers.get(row.provider);
  return entry
    ? entry.factory.attach(row.id)
    : Promise.resolve(
        err(
          unavailable(
            `${row.provider} sandboxes are not configured on this instance`
          )
        )
      );
};

/** The workspace a create or restart left, if it started. */
const started = (
  deps: TurnSandboxDeps,
  record: SandboxRecord
): AsyncResult<Sandbox, SandboxError> =>
  record.status.state === "failed"
    ? Promise.resolve(err(unavailable(record.status.message)))
    : attachTo(deps, record);

/** Starts the row's workspace again in place: same id, same provider. */
const restart = async (
  deps: TurnSandboxDeps,
  viewer: Viewer,
  row: SandboxRow
): AsyncResult<Sandbox, SandboxError> => {
  const reset = await resetSandbox(
    { ...deps, session: viewer },
    { id: row.id }
  );
  return reset.ok
    ? started(deps, reset.value)
    : err(unavailable(describe(reset.error)));
};

/**
 * Whether a failed attach means the workspace is gone rather than out of
 * reach. just-bash lives in this process, so there's no host to be down:
 * if it can't attach, the workspace went with a restart.
 */
const isGone = (row: SandboxRow, error: SandboxError): boolean =>
  error.type === "destroyed" || row.provider === FALLBACK;

const resume = async (
  deps: TurnSandboxDeps,
  viewer: Viewer,
  row: SandboxRow
): AsyncResult<Sandbox, SandboxError> => {
  // Checked when it starts, not when the run was created: access can be
  // cut back while a run waits in the queue or for an approval.
  const allowed = await authorizeSandboxExec(
    { db: deps.db, session: viewer },
    row.id
  );
  if (!allowed.ok) {
    return err(unavailable(describe(allowed.error)));
  }
  switch (row.state) {
    case "failed":
    case "destroyed":
      return restart(deps, viewer, row);
    // Someone else is starting it.
    case "provisioning":
      return attachTo(deps, row);
    // A stopped one resumes from its volume when it's attached.
    case "ready":
    case "stopped": {
      const attached = await attachTo(deps, row);
      if (attached.ok) {
        // It's about to be used, so waking a stopped one here costs nothing.
        await restoreRecordedPreviews(deps, attached.value, row);
        return attached;
      }
      return isGone(row, attached.error)
        ? restart(deps, viewer, row)
        : attached;
    }
    default:
      return row.state satisfies never;
  }
};

/**
 * The chat's workspace, ready for a tool: created with `wanted` (or
 * just-bash, if `wanted`'s host is down) when the chat has none; restarted
 * in place when its last start failed or it was destroyed; re-attached when
 * stopped. A start that fails is reported, and the next call tries again,
 * so nobody has to press Reset.
 */
export const ensureWorkspace = async (
  deps: TurnSandboxDeps,
  viewer: Viewer,
  conversationId: ConversationId,
  wanted: SandboxProvider
): AsyncResult<Sandbox, SandboxError> => {
  const existing = await getSandboxForConversation(deps.db, conversationId);
  if (existing) {
    return resume(deps, viewer, existing);
  }
  const created = await createConversationSandbox(
    { ...deps, session: viewer },
    { conversationId, provider: await reachableProvider(deps, wanted) }
  );
  if (created.ok) {
    return started(deps, created.value);
  }
  if (created.error.type !== "already_exists") {
    return err(unavailable(describe(created.error)));
  }
  // Someone else's create won the race; theirs is the chat's workspace.
  const theirs = await getSandboxForConversation(deps.db, conversationId);
  return theirs
    ? resume(deps, viewer, theirs)
    : err(unavailable("The workspace couldn't start."));
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
    const record = (
      id: SandboxId,
      exposed: { readonly port: number; readonly url: string }
    ) => recordPreview(deps.db, id, exposed);
    const sandbox = lazySandbox(
      async () =>
        ensureWorkspace(
          deps,
          await viewerOf(deps.db, run),
          run.conversationId,
          provider
        ),
      record
    );
    /** A page the agent wrote previews without a server of its own (067). */
    const onChanged = async (path: string) => {
      if (!isStaticPage(path)) {
        return;
      }
      // The change just landed, so this is the sandbox it landed in.
      const current = await sandbox.current();
      if (current.ok) {
        await previewStaticPage(current.value, path, {
          log: deps.log,
          record,
          sleep: deps.sleep,
        });
      }
    };
    return {
      proposeEdits: (call) => proposal(sandbox, call),
      provider,
      readFile: workspaceRead(sandbox),
      tools: createSandboxTools({
        onChanged,
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
      writeFile: workspaceWrite(sandbox),
    };
  };

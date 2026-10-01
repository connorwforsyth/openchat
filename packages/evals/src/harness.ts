import { readRunStream } from "@workspace/client/run-stream";
import type {
  ConversationId,
  FileId,
  MessageId,
  RunId,
} from "@workspace/contract/schemas/common";
import type {
  ApprovalDecision,
  MessagePart,
  UserMessagePart,
} from "@workspace/contract/schemas/message-parts";
import type { Message } from "@workspace/contract/schemas/messages";
import type {
  PendingApproval,
  Run,
  RunOptions,
  RunStatus,
} from "@workspace/contract/schemas/runs";
import type { UIMessageChunk } from "ai";

import type { ObservedToolCall } from "./assertions";
import type { JudgedTurn } from "./judge";
import type { TurnSummary } from "./report";
import { readSequenced, type SequencedStream } from "./sse";
import type { Session, UserName, World } from "./world";

// What a case drives: the app's own HTTP API, as a client would, with no
// browser. `send` starts a run and follows it until it stops moving (done,
// or waiting for an approval); `approve`, `reject` and `stop` act on it;
// `reload` looks at it as a page that just loaded would; `files` lists the
// chat's workspace. Everything a `Turn` reports is read back from the
// server (the stored messages and the run row), except `stream`, which is
// what the run's SSE stream delivered while the case watched.

/** Where the chat's workspace is mounted; its files are listed relative to it. */
const WORKDIR = "/work/";

const POLL_MS = 40;
const SETTLE_TIMEOUT_MS = 45_000;
const STREAM_CLOSE_MS = 5000;
const REPLAY_TIMEOUT_MS = 10_000;

export interface StreamView {
  readonly chunks: readonly UIMessageChunk[];
  /** The stream ended with `[DONE]`. */
  readonly done: boolean;
  /** Why the stream broke, if it did. */
  readonly error: string | null;
}

/** A run as the server has it, once it stopped moving. */
export interface Turn {
  readonly as: UserName;
  /** The answer being written; `null` if the run never started. */
  readonly assistantMessageId: MessageId | null;
  readonly conversationId: ConversationId;
  /** The text that was sent. */
  readonly message: string;
  /** Calls waiting for a decision (empty unless `status` is `awaiting_approval`). */
  readonly pending: readonly PendingApproval[];
  readonly run: Run;
  readonly runId: RunId;
  readonly status: RunStatus;
  readonly stream: StreamView;
  /** The stored answer's text. */
  readonly text: string;
  /** The stored answer's tool calls, in order, with their results. */
  readonly toolCalls: readonly ObservedToolCall[];
  readonly userMessageId: MessageId;
}

export interface ActOptions {
  /** Who acts; the case's first sender otherwise. */
  readonly as?: UserName;
  /** Which run; the last one the case started otherwise. */
  readonly turn?: Turn;
}

export interface SendOptions {
  readonly as?: UserName;
  /** Uploaded files that go with the message, as the composer attaches them. */
  readonly attachments?: readonly {
    readonly filename: string;
    readonly id: FileId;
    readonly mediaType: string;
  }[];
  /** Another conversation than the case's current one. */
  readonly chat?: ConversationId;
  /** Workspace files the message mentions with `@`. */
  readonly mentions?: readonly string[];
  /** The message this one follows; the branch's last message otherwise. `null` starts a new root. */
  readonly parentId?: MessageId | null;
  /** The composer's per-turn switches. */
  readonly run?: Partial<RunOptions>;
  /** `false` returns as soon as the run exists, without waiting for it to stop moving. */
  readonly wait?: boolean;
}

export interface DecideOptions extends ActOptions {
  /** Tool call ids or tool names to decide; every pending call otherwise. */
  readonly only?: readonly string[];
}

export interface WorkspaceFile {
  /** Relative to the workspace root. */
  readonly path: string;
  readonly size: number | null;
  readonly type: "file" | "directory" | "symlink";
}

export interface Reloaded {
  /** Runs the conversation still has going, as a loading page asks for them. */
  readonly activeRuns: readonly Run[];
  /** The branch as stored, root first. */
  readonly messages: readonly Message[];
  /** What a new connection to the run's stream replays from the start. */
  readonly replay: SequencedStream;
  readonly turn: Turn;
}

export interface Harness {
  /** The typed API client as `name`, for what the actions below don't cover. */
  readonly api: (name?: UserName) => Session["api"];
  /** Approves pending calls and follows the run on. */
  readonly approve: (options?: DecideOptions) => Promise<Turn>;
  /** The case's current conversation; `null` before the first `send`. */
  readonly chat: () => ConversationId | null;
  /** Polls `read` until `done` holds (background work: titles, indexing). */
  readonly eventually: <T>(
    read: () => Promise<T>,
    done: (value: T) => boolean,
    timeoutMs?: number
  ) => Promise<T>;
  /** The chat's workspace files, recursively; empty if it has no workspace. */
  readonly files: (options?: {
    readonly as?: UserName;
    readonly chat?: ConversationId;
  }) => Promise<readonly WorkspaceFile[]>;
  /** Starts a new conversation and makes it the case's current one. */
  readonly newChat: (options?: {
    readonly as?: UserName;
  }) => Promise<ConversationId>;
  /** A workspace file's text, or `null` if it isn't there. */
  readonly readFile: (
    path: string,
    options?: { readonly as?: UserName; readonly chat?: ConversationId }
  ) => Promise<string | null>;
  /** Answers the run's user message again, as Regenerate does. */
  readonly regenerate: (options?: ActOptions) => Promise<Turn>;
  /** Rejects pending calls and follows the run on. */
  readonly reject: (reason?: string, options?: DecideOptions) => Promise<Turn>;
  /** What a page that just loaded would see of the run. */
  readonly reload: (options?: ActOptions) => Promise<Reloaded>;
  /** Sends a message and follows its run until it stops moving. */
  readonly send: (message: string, options?: SendOptions) => Promise<Turn>;
  /** The run as the server has it now, once it stops moving. */
  readonly settled: (options?: ActOptions) => Promise<Turn>;
  /** The HTTP status `call` ends with: 200 when it resolves, the error's otherwise. */
  readonly statusOf: (call: () => Promise<unknown>) => Promise<number>;
  /** Cancels the run, as Stop does, and waits for it to end. */
  readonly stop: (options?: ActOptions) => Promise<Turn>;
  /** One connection to a run's stream from `cursor`, read until it's caught up or done. */
  readonly streamOf: (
    turn: Turn,
    options?: { readonly as?: UserName; readonly cursor?: number }
  ) => Promise<SequencedStream>;
  readonly user: (name: UserName) => Session;
  readonly world: World;
}

/** What the runner needs from a case's harness once the case is over. */
export interface HarnessControl {
  readonly calls: () => readonly ObservedToolCall[];
  /** Closes the streams and stops whatever is still running. */
  readonly cleanup: () => Promise<void>;
  readonly summaries: () => readonly TurnSummary[];
  readonly transcript: () => readonly JudgedTurn[];
}

interface Tracked {
  readonly abort: AbortController;
  readonly as: UserName;
  readonly chunks: UIMessageChunk[];
  readonly conversationId: ConversationId;
  latest: Turn | null;
  readonly message: string;
  /** Resolves when the stream reader stops. */
  reader: Promise<void>;
  readonly runId: RunId;
  readonly stream: { done: boolean; error: string | null };
  readonly userMessageId: MessageId;
}

const sleep = (ms: number) =>
  new Promise<void>((done) => {
    setTimeout(done, ms);
  });

const TERMINAL: readonly RunStatus[] = ["succeeded", "failed", "cancelled"];

const approvalOf = (
  part: Extract<MessagePart, { type: "tool-call" }>
): ObservedToolCall["approval"] =>
  part.approval.state === "decided"
    ? part.approval.decision.decision
    : part.approval.state;

/** The tool calls of `runId`'s answer on a branch, each with its result. Pure. */
export const toolCallsOf = (
  messages: readonly Message[],
  runId: string
): readonly ObservedToolCall[] => {
  const parts = messages.flatMap((message) => message.parts);
  const results = new Map(
    parts.flatMap((part) =>
      part.type === "tool-result"
        ? [[part.toolCallId, part.output] as const]
        : []
    )
  );
  return messages
    .filter(
      (message) => message.runId === runId && message.role === "assistant"
    )
    .flatMap((message) => message.parts)
    .flatMap((part): ObservedToolCall[] => {
      if (part.type !== "tool-call") {
        return [];
      }
      const output = results.get(part.toolCallId);
      let shown: unknown = null;
      if (output?.status === "success") {
        shown = output.value;
      } else if (output?.status === "error") {
        shown = output.message;
      } else if (output?.status === "denied") {
        shown = output.decision;
      }
      return [
        {
          approval: approvalOf(part),
          input: part.input,
          name: part.toolName,
          output: shown,
          result: output?.status ?? "none",
          runId,
          toolCallId: part.toolCallId,
        },
      ];
    });
};

/** The text of `runId`'s answer on a branch. Pure. */
export const textOf = (messages: readonly Message[], runId: string): string =>
  messages
    .filter(
      (message) => message.runId === runId && message.role === "assistant"
    )
    .flatMap((message) => message.parts)
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("");

const statusFrom = (cause: unknown): number | null => {
  const status = (cause as { readonly status?: unknown } | null)?.status;
  return typeof status === "number" ? status : null;
};

const NO_SUCH_FILE = /no such file/i;

/** The Files routes answer a missing path with a 404, or a 422 that says so. */
const isMissingFile = (cause: unknown): boolean => {
  const status = statusFrom(cause);
  if (status === 404) {
    return true;
  }
  return status === 422 && NO_SUCH_FILE.test(JSON.stringify(cause));
};

export const createHarness = (
  world: World
): { readonly control: HarnessControl; readonly harness: Harness } => {
  const tracked: Tracked[] = [];
  /** Where each conversation's branch ends, as the case left it. */
  const leaves = new Map<ConversationId, MessageId>();
  let current: ConversationId | null = null;
  let firstActor: UserName | null = null;

  const actor = (name: UserName | undefined): Session =>
    world.users[name ?? firstActor ?? "ada"];

  const find = (turn: Turn | undefined): Tracked => {
    const found = turn
      ? tracked.find((each) => each.runId === turn.runId)
      : tracked.at(-1);
    if (!found) {
      throw new Error("the case hasn't started a run yet");
    }
    return found;
  };

  const follow = (record: Tracked, session: Session) => {
    const stream = readRunStream(
      `${world.baseUrl}/api/runs/${record.runId}/stream`,
      {
        fetch: globalThis.fetch,
        headers: session.headers,
        signal: record.abort.signal,
      }
    );
    record.reader = (async () => {
      try {
        const reader = stream.getReader();
        for (;;) {
          // biome-ignore lint/performance/noAwaitInLoops: a stream is read in order.
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          record.chunks.push(value);
        }
        record.stream.done = !record.abort.signal.aborted;
      } catch (cause) {
        if (!record.abort.signal.aborted) {
          record.stream.error =
            cause instanceof Error ? cause.message : String(cause);
        }
      }
    })();
  };

  const observe = async (record: Tracked, session: Session): Promise<Turn> => {
    const run = await session.api.runs.get({ id: record.runId });
    const branch = run.assistantMessageId
      ? await session.api.messages.path({
          conversationId: record.conversationId,
          leafId: run.assistantMessageId,
        })
      : null;
    const messages = branch?.messages ?? [];
    const toolCalls = toolCallsOf(messages, record.runId);
    const undecided = new Set(
      toolCalls
        .filter((call) => call.approval === "pending")
        .map((call) => call.toolCallId)
    );
    const turn: Turn = {
      as: record.as,
      assistantMessageId: run.assistantMessageId,
      conversationId: record.conversationId,
      message: record.message,
      // The run lists every call of the paused step until all are decided;
      // what still waits is what the stored call says is pending.
      pending:
        run.state.status === "awaiting_approval"
          ? run.state.approvals.filter((each) => undecided.has(each.toolCallId))
          : [],
      run,
      runId: record.runId,
      status: run.state.status,
      stream: {
        chunks: [...record.chunks],
        done: record.stream.done,
        error: record.stream.error,
      },
      text: textOf(messages, record.runId),
      toolCalls,
      userMessageId: record.userMessageId,
    };
    record.latest = turn;
    const newest = tracked.findLast(
      (each) => each.conversationId === record.conversationId
    );
    if (newest === record) {
      // The next message follows this answer, as it would on screen.
      leaves.set(
        record.conversationId,
        run.assistantMessageId ?? record.userMessageId
      );
    }
    return turn;
  };

  /**
   * Waits until the run stops moving: it ended, or it waits on an approval
   * that nobody has decided yet. (A run whose last pending call was just
   * decided still says `awaiting_approval` for a moment.)
   */
  const settle = async (record: Tracked, session: Session): Promise<Turn> => {
    const deadline = Date.now() + SETTLE_TIMEOUT_MS;
    for (;;) {
      // biome-ignore lint/performance/noAwaitInLoops: polling is sequential by nature.
      const run = await session.api.runs.get({ id: record.runId });
      const { status } = run.state;
      if (TERMINAL.includes(status)) {
        // The stream closes just after the run settles.
        await Promise.race([record.reader, sleep(STREAM_CLOSE_MS)]);
        return observe(record, session);
      }
      if (status === "awaiting_approval") {
        const turn = await observe(record, session);
        if (turn.status === "awaiting_approval" && turn.pending.length > 0) {
          return turn;
        }
      }
      if (Date.now() > deadline) {
        throw new Error(
          `run ${record.runId} was still ${status} after ${SETTLE_TIMEOUT_MS / 1000} s`
        );
      }
      await sleep(POLL_MS);
    }
  };

  const track = (
    session: Session,
    created: {
      readonly conversationId: ConversationId;
      readonly runId: RunId;
      readonly userMessageId: MessageId;
    },
    message: string
  ): Tracked => {
    const record: Tracked = {
      abort: new AbortController(),
      as: session.name,
      chunks: [],
      conversationId: created.conversationId,
      latest: null,
      message,
      reader: Promise.resolve(),
      runId: created.runId,
      stream: { done: false, error: null },
      userMessageId: created.userMessageId,
    };
    tracked.push(record);
    leaves.set(created.conversationId, created.userMessageId);
    follow(record, session);
    return record;
  };

  const newChat: Harness["newChat"] = async (options = {}) => {
    const session = actor(options.as);
    firstActor ??= session.name;
    const chat = await session.api.conversations.create({});
    current = chat.id;
    return chat.id;
  };

  const send: Harness["send"] = async (message, options = {}) => {
    const session = actor(options.as);
    firstActor ??= session.name;
    const conversationId =
      options.chat ?? current ?? (await newChat({ as: session.name }));
    const parts: UserMessagePart[] = [
      { text: message, type: "text" },
      ...(options.mentions ?? []).map(
        (path): UserMessagePart => ({
          data: { path },
          name: "workspace-file",
          type: "data",
        })
      ),
      ...(options.attachments ?? []).map(
        (file): UserMessagePart => ({
          filename: file.filename,
          mediaType: file.mediaType,
          source: { fileId: file.id, kind: "file" },
          type: "file",
        })
      ),
    ];
    const parentId =
      options.parentId === undefined
        ? (leaves.get(conversationId) ?? null)
        : options.parentId;
    const created = await session.api.runs.create({
      conversationId,
      input: { parentId, parts, type: "message" },
      ...(options.run ? { options: options.run } : {}),
    });
    const record = track(session, created, message);
    return options.wait === false
      ? observe(record, session)
      : settle(record, session);
  };

  const regenerate: Harness["regenerate"] = async (options = {}) => {
    const previous = find(options.turn);
    const session = actor(options.as ?? previous.as);
    const created = await session.api.runs.create({
      conversationId: previous.conversationId,
      input: { type: "regenerate", userMessageId: previous.userMessageId },
    });
    return settle(track(session, created, previous.message), session);
  };

  const decide = async (
    decision: ApprovalDecision,
    options: DecideOptions
  ): Promise<Turn> => {
    const record = find(options.turn);
    const session = actor(options.as ?? record.as);
    const { pending, status } = await observe(record, session);
    const chosen = pending.filter(
      (each) =>
        options.only === undefined ||
        options.only.includes(each.toolCallId) ||
        options.only.includes(each.toolName)
    );
    if (chosen.length === 0) {
      throw new Error(
        `nothing to decide: the run is ${status} with ${pending.length} pending`
      );
    }
    await session.api.runs.submitApprovals({
      decisions: chosen.map(({ toolCallId }) => ({ decision, toolCallId })),
      runId: record.runId,
    });
    return settle(record, session);
  };

  const streamOf: Harness["streamOf"] = async (turn, options = {}) => {
    const session = actor(options.as ?? turn.as);
    const cursor = options.cursor ?? 0;
    // Caught up once it has delivered everything the run had written when
    // this connection opened.
    const run = await session.api.runs
      .get({ id: turn.runId })
      .catch(() => null);
    const response = await session.fetch(
      `/api/runs/${turn.runId}/stream?cursor=${cursor}`,
      {
        headers: { accept: "text/event-stream" },
        signal: AbortSignal.timeout(REPLAY_TIMEOUT_MS),
      }
    );
    return readSequenced(response, {
      cursor,
      upTo: run?.lastSeq ?? Number.POSITIVE_INFINITY,
    });
  };

  const sandboxOf = async (
    session: Session,
    chat: ConversationId | undefined
  ) => {
    const conversationId = chat ?? current;
    return conversationId
      ? await session.api.sandbox.get({ conversationId })
      : null;
  };

  const harness: Harness = {
    api: (name) => actor(name).api,
    approve: (options = {}) => decide({ decision: "approve" }, options),
    chat: () => current,
    eventually: async (read, done, timeoutMs = 30_000) => {
      const deadline = Date.now() + timeoutMs;
      let last = await read();
      while (!done(last)) {
        if (Date.now() > deadline) {
          throw new Error(
            `timed out after ${timeoutMs} ms; last value: ${JSON.stringify(last)?.slice(0, 500)}`
          );
        }
        // biome-ignore lint/performance/noAwaitInLoops: polling is sequential by nature.
        await sleep(150);
        last = await read();
      }
      return last;
    },
    files: async (options = {}) => {
      const session = actor(options.as);
      const sandbox = await sandboxOf(session, options.chat);
      if (!sandbox) {
        return [];
      }
      const entries = await session.api.sandbox.listFiles({
        id: sandbox.id,
        path: ".",
        recursive: true,
      });
      return entries.map((entry) => ({
        path: entry.path.startsWith(WORKDIR)
          ? entry.path.slice(WORKDIR.length)
          : entry.path,
        size: entry.size,
        type: entry.type,
      }));
    },
    newChat,
    readFile: async (path, options = {}) => {
      const session = actor(options.as);
      const sandbox = await sandboxOf(session, options.chat);
      if (!sandbox) {
        return null;
      }
      try {
        const file = await session.api.sandbox.readFile({
          id: sandbox.id,
          path,
        });
        return file.encoding === "utf8"
          ? file.content
          : Buffer.from(file.content, "base64").toString("latin1");
      } catch (cause) {
        if (isMissingFile(cause)) {
          return null;
        }
        throw cause;
      }
    },
    regenerate,
    reject: (reason, options = {}) =>
      decide(
        { decision: "reject", ...(reason === undefined ? {} : { reason }) },
        options
      ),
    reload: async (options = {}) => {
      const record = find(options.turn);
      const session = actor(options.as ?? record.as);
      // What a page asks for as it loads: the branch, the runs still going,
      // and the run's stream from the start.
      const [branch, active] = await Promise.all([
        session.api.messages.path({ conversationId: record.conversationId }),
        session.api.runs.list({
          active: true,
          conversationId: record.conversationId,
          limit: 20,
        }),
      ]);
      const turn = await observe(record, session);
      const replay = await streamOf(turn, { as: session.name });
      return {
        activeRuns: active.items,
        messages: branch.messages,
        replay,
        turn,
      };
    },
    send,
    settled: (options = {}) => {
      const record = find(options.turn);
      return settle(record, actor(options.as ?? record.as));
    },
    statusOf: async (call) => {
      try {
        await call();
        return 200;
      } catch (cause) {
        const status = statusFrom(cause);
        if (status === null) {
          throw cause;
        }
        return status;
      }
    },
    stop: async (options = {}) => {
      const record = find(options.turn);
      const session = actor(options.as ?? record.as);
      await session.api.runs.cancel({ id: record.runId });
      return settle(record, session);
    },
    streamOf,
    user: (name) => world.users[name],
    world,
  };

  const latest = (): readonly Turn[] =>
    tracked.flatMap((record) => (record.latest ? [record.latest] : []));

  const control: HarnessControl = {
    calls: () => latest().flatMap((turn) => turn.toolCalls),
    cleanup: async () => {
      await Promise.all(
        tracked.map(async (record) => {
          const session = world.users[record.as];
          const status = record.latest?.status;
          if (status === undefined || !TERMINAL.includes(status)) {
            // Nothing a case started should outlive it: a sleeping command
            // would hold the branch and the machine.
            await session.api.runs
              .cancel({ id: record.runId })
              .catch(() => undefined);
          }
          record.abort.abort();
          await Promise.race([record.reader, sleep(1000)]);
        })
      );
    },
    summaries: () =>
      latest().map((turn) => ({
        as: turn.as,
        message: turn.message.slice(0, 2000),
        reply: turn.text.slice(0, 2000),
        runId: turn.runId,
        status: turn.status,
        toolCalls: turn.toolCalls.map((call) => ({
          approval: call.approval,
          input: call.input,
          name: call.name,
          result: call.result,
        })),
      })),
    transcript: () =>
      latest().map((turn) => ({
        as: turn.as,
        message: turn.message,
        reply: turn.text,
        toolCalls: turn.toolCalls.map((call) => ({
          input: call.input,
          name: call.name,
          output: call.output,
          result: call.result,
        })),
      })),
  };

  return { control, harness };
};

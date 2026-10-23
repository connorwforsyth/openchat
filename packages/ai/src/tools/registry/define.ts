import type {
  ConversationId,
  MessageId,
  RunId,
  UserId,
} from "@workspace/contract/schemas/common";
import type { FlexibleSchema, Tool } from "ai";
import type { z } from "zod";

import type { ApprovalMode } from "../resolve";

// One shape for every tool a run can be given (080): a name, what the model
// is told, a schema for its input, and an `execute` that takes the input
// and a context of our own, instead of whatever each factory closed over.
// A built-in is written once, in a file of its own, with `defineTool`; MCP
// and client tools are adapted into the same shape (`adapt.ts`), and
// `toAiSdkTool` turns any of them into what `ToolLoopAgent` takes.
//
// The types are ours, not the AI SDK's, so a definition says nothing about
// the loop that runs it.

/** Who the tool acts for: the run's creator. */
export interface ToolActor {
  readonly userId: UserId;
}

/** The chat the call happens in, and the run and answer it belongs to. */
export interface ToolConversation {
  readonly id: ConversationId | null;
  readonly messageId?: MessageId;
  readonly runId?: RunId;
}

/** Something a call reports while it runs (`bash` output as it arrives). */
export interface ToolEvent {
  readonly toolCallId: string;
  readonly type: string;
}

/**
 * What a run binds its tools to, before any call. Every part is optional
 * here; a definition names the parts it needs by narrowing this type, and
 * then `toAiSdkTool` won't bind it without them.
 */
export interface ToolRunContext {
  readonly actor?: ToolActor;
  readonly conversation?: ToolConversation;
  /**
   * Reports progress to whoever bound the run. A definition narrows the
   * parameter to the events it sends (any `ToolEvent`), hence `never` here.
   */
  readonly emit?: (event: never) => void;
  /** The ports the tool's own file asks for (a store, a search backend). */
  readonly ports?: unknown;
  /** The chat's sandbox as the tool reaches it; `@workspace/sandbox` types it. */
  readonly workspace?: unknown;
}

/** A file the model is shown with a call's result: an image `read` found. */
export interface ToolModelFile {
  /** Base64. */
  readonly data: string;
  readonly mediaType: string;
}

/** What `execute` gets: the run's bindings, plus this call's id and abort signal. */
export type ToolContext<Run extends ToolRunContext = ToolRunContext> = Run & {
  /**
   * Shows the model `file` after the result's `modelText`, in this run
   * only: the stored result stays what `execute` returns, so a chat's
   * history never carries the bytes. Absent when the definition has no
   * `modelText`.
   */
  readonly show?: (file: ToolModelFile) => void;
  /** Aborts when the run is stopped (072) or times out. */
  readonly signal: AbortSignal | undefined;
  readonly toolCallId: string;
};

/**
 * What the instance or the run must have for the tool to be offered. It
 * describes; `resolveTools` and the turn resolver still decide.
 */
export type ToolCapability =
  | "artifacts"
  | "images"
  | "knowledge"
  | "memory"
  | "sandbox"
  | "skills"
  | "web_search";

/** Where a definition came from. */
export type ToolSource = "builtin" | "client" | "mcp";

export interface ToolDefinition<
  Input = unknown,
  Output = unknown,
  Run extends ToolRunContext = ToolRunContext,
> {
  /**
   * The default when nobody has said otherwise: what the tool does today in
   * a plain chat, or under an agent that leaves it alone. A default only:
   * agents, the instance and (one day) a policy engine decide the rest, and
   * nothing reads this to decide a call yet.
   */
  readonly approval: Exclude<ApprovalMode, "deny">;
  readonly capability?: ToolCapability;
  readonly description?: string;
  /**
   * Absent for a client tool: the run stops at the call and a client
   * supplies the output.
   */
  readonly execute?: (
    input: Input,
    ctx: ToolContext<Run>
  ) => Output | PromiseLike<Output>;
  /** Zod for a built-in; JSON Schema (wrapped by the AI SDK) for the rest. */
  readonly input: FlexibleSchema<Input>;
  /** What the model reads instead of the result's JSON, when that's kinder. */
  readonly modelText?: (output: Output) => string;
  /** The name the model calls it by; unique in a tool set. */
  readonly name: string;
  readonly output?: FlexibleSchema<Output>;
  /**
   * An adapted tool as its source built it (`@ai-sdk/mcp`'s dynamic tools
   * carry more than this shape holds). `toAiSdkTool` hands it back as it is.
   */
  readonly sdkTool?: Tool;
  readonly source: ToolSource;
}

/**
 * A definition of any input and output, as registries hold them. Every
 * `ToolDefinition` fits; to call one, keep its own type.
 */
export interface AnyToolDefinition
  extends Omit<ToolDefinition, "execute" | "input" | "modelText" | "output"> {
  readonly execute?: (input: never, ctx: never) => unknown;
  readonly input: FlexibleSchema<unknown>;
  readonly modelText?: (output: never) => string;
  readonly output?: FlexibleSchema<unknown>;
}

/** What `defineTool` returns: a definition with nothing left optional that a built-in always has. */
export type BuiltinTool<
  Name extends string = string,
  Input = unknown,
  Output = unknown,
  Run extends ToolRunContext = ToolRunContext,
> = ToolDefinition<Input, Output, Run> & {
  readonly description: string;
  readonly execute: (
    input: Input,
    ctx: ToolContext<Run>
  ) => Output | PromiseLike<Output>;
  readonly input: z.ZodType<Input>;
  readonly name: Name;
};

export interface BuiltinToolSpec<
  Name extends string,
  Input,
  Output,
  Run extends ToolRunContext,
> {
  /** Defaults to `auto`: it runs without asking. */
  readonly approval?: Exclude<ApprovalMode, "deny">;
  readonly capability?: ToolCapability;
  readonly description: string;
  readonly execute: (
    input: Input,
    ctx: ToolContext<Run>
  ) => Output | PromiseLike<Output>;
  readonly input: z.ZodType<Input>;
  readonly modelText?: (output: Output) => string;
  readonly name: Name;
  readonly output?: z.ZodType<Output>;
}

/** A built-in tool. Pure: it only names things; nothing runs until it's bound. */
export const defineTool = <
  const Name extends string,
  Input,
  Output,
  Run extends ToolRunContext = ToolRunContext,
>(
  spec: BuiltinToolSpec<Name, Input, Output, Run>
): BuiltinTool<Name, Input, Output, Run> => ({
  ...spec,
  approval: spec.approval ?? "auto",
  source: "builtin",
});

// The wizard's only view of the terminal (a port, AGENTS.md: ports are
// function arguments). `clack.ts` is the real one; `createScriptedPrompter`
// answers from a script, for tests. Every prompt has an `id` so a script can
// answer it by name and leave the rest at their defaults, like pressing Enter.

export const CANCELLED = Symbol("cancelled");
export type Cancelled = typeof CANCELLED;

export interface Choice<V extends string> {
  readonly hint?: string;
  readonly label: string;
  readonly value: V;
}

/** A problem to show under the input, or `undefined` when it's fine. */
export type Validate = (value: string) => string | undefined;

export interface Prompter {
  confirm: (prompt: {
    readonly id: string;
    readonly initial: boolean;
    readonly message: string;
  }) => Promise<boolean | Cancelled>;
  /** Shown as-is; callers never pass a secret. */
  info: (message: string) => void;
  multiselect: <V extends string>(prompt: {
    readonly id: string;
    readonly initial: readonly V[];
    readonly message: string;
    readonly options: readonly Choice<V>[];
  }) => Promise<V[] | Cancelled>;
  note: (message: string, title: string) => void;
  /**
   * Masked input: what's typed is never shown, echoed or logged. An empty
   * answer means "keep what's there" (or "none").
   */
  secret: (prompt: {
    readonly id: string;
    readonly message: string;
    readonly validate?: Validate;
  }) => Promise<string | Cancelled>;
  select: <V extends string>(prompt: {
    readonly id: string;
    readonly initial: V;
    readonly message: string;
    readonly options: readonly Choice<V>[];
  }) => Promise<V | Cancelled>;
  text: (prompt: {
    readonly id: string;
    readonly initial: string;
    readonly message: string;
    readonly validate?: Validate;
  }) => Promise<string | Cancelled>;
  warn: (message: string) => void;
}

export type Script = Readonly<Record<string, unknown>>;

export interface ScriptedPrompter extends Prompter {
  /** Prompt ids in the order they were asked. */
  readonly asked: string[];
  /** Every message, option label, note and warning shown, in order. */
  readonly shown: string[];
}

/**
 * Answers each prompt from `script[id]`, or its default when the script has
 * none. A scripted text answer that fails its prompt's validation throws: a
 * real person would be asked again, and a test wants to know.
 */
export const createScriptedPrompter = (script: Script): ScriptedPrompter => {
  const asked: string[] = [];
  const shown: string[] = [];

  const answer = <T>(id: string, fallback: T, validate?: Validate): T => {
    asked.push(id);
    const value = Object.hasOwn(script, id) ? script[id] : fallback;
    if (typeof value === "string" && validate) {
      const problem = validate(value);
      if (typeof problem === "string") {
        throw new Error(`scripted answer for ${id} is invalid: ${problem}`);
      }
    }
    return value as T;
  };

  return {
    asked,
    confirm: ({ id, initial, message }) => {
      shown.push(message);
      return Promise.resolve(answer(id, initial));
    },
    info: (message) => {
      shown.push(message);
    },
    multiselect: ({ id, initial, message, options }) => {
      shown.push(message, ...options.map((option) => option.label));
      return Promise.resolve(answer(id, [...initial]));
    },
    note: (message, title) => {
      shown.push(title, message);
    },
    secret: ({ id, message, validate }) => {
      shown.push(message);
      return Promise.resolve(answer(id, "", validate));
    },
    select: ({ id, initial, message, options }) => {
      shown.push(message, ...options.map((option) => option.label));
      return Promise.resolve(answer(id, initial));
    },
    shown,
    text: ({ id, initial, message, validate }) => {
      shown.push(message);
      return Promise.resolve(answer(id, initial, validate));
    },
    warn: (message) => {
      shown.push(message);
    },
  };
};

import type { RunTarget } from "@workspace/contract/schemas/runs";

// What a message carries as its target (111). The picker can show a guess
// while things load; a message never goes out with one. Without a target
// the server answers with the chat's own default (or the instance's), where
// a guessed `auto` failed every send on an instance with auto turned off.

export interface MessageTargetInput {
  /** The open chat's own target, once loaded. */
  readonly chatDefault: RunTarget | null | undefined;
  /** A chat whose details haven't loaded yet. */
  readonly chatLoading: boolean;
  /** The last pick in this tab, if any. */
  readonly chosen: RunTarget | null | undefined;
  /** The guess from the model list, once that list has loaded. */
  readonly fallback: RunTarget | null;
  /** The person's own default, from settings. */
  readonly userDefault: RunTarget | null | undefined;
}

export const messageTarget = ({
  chatDefault,
  chosen,
  fallback,
  chatLoading,
  userDefault,
}: MessageTargetInput): RunTarget | null =>
  chatDefault ?? chosen ?? (chatLoading ? null : (userDefault ?? fallback));

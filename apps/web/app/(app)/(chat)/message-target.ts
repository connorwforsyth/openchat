import type { RunTarget } from "@workspace/contract/schemas/runs";

// What a message carries as its target (111). The picker can show a guess
// while things load; a message never goes out with one. Without a target
// the server answers with the chat's own default (or the instance's), where
// a guessed `auto` failed every send on an instance with auto turned off.
//
// A pick made in the open chat wins over its details (132): they can land
// after the pick, from a fetch that started before it (the chat loading, or
// a refetch after a turn), and still say the old model. Letting them win
// put the old model back on screen and on the next message, and the
// thinking level and fast mode went with it.

export interface MessageTargetInput {
  /** The open chat's own target, once loaded. */
  readonly chatDefault: RunTarget | null | undefined;
  /** A chat whose details haven't loaded yet. */
  readonly chatLoading: boolean;
  /** The last pick in this tab, if any. */
  readonly chosen: RunTarget | null | undefined;
  /** The guess from the model list, once that list has loaded. */
  readonly fallback: RunTarget | null;
  /** A pick made in the open chat, in this tab, since it was opened. */
  readonly pickedHere?: RunTarget | null | undefined;
  /** The person's own default, from settings. */
  readonly userDefault: RunTarget | null | undefined;
}

export const messageTarget = ({
  chatDefault,
  chosen,
  fallback,
  chatLoading,
  pickedHere,
  userDefault,
}: MessageTargetInput): RunTarget | null =>
  pickedHere ??
  chatDefault ??
  chosen ??
  (chatLoading ? null : (userDefault ?? fallback));

/**
 * The target the picker shows: the same order, but always something, so
 * while things load it shows the guess (`fallback`).
 */
export const shownTarget = ({
  chatDefault,
  chosen,
  fallback,
  pickedHere,
  userDefault,
}: Omit<MessageTargetInput, "chatLoading" | "fallback"> & {
  readonly fallback: RunTarget;
}): RunTarget => pickedHere ?? chatDefault ?? chosen ?? userDefault ?? fallback;

// Whether the outputs card shows (night 2, decision 4). Where the chat
// column has room it's pinned open or collapsed to the header button, and
// that choice is remembered. Where it hasn't, the card only peeks: the
// button opens it over the chat and any pick, Escape or click away closes
// it, leaving the pinned choice alone. A pinned card with nothing in it stays
// out of the way unless it was just asked for. Pure.

export interface OutputsState {
  /** Asked for since the chat opened: shows even with nothing in it. */
  readonly asked: boolean;
  /** Open on a narrow column, until the next pick or click away. */
  readonly peek: boolean;
  /** Open where the column has room; the remembered choice. */
  readonly pinned: boolean;
}

export interface OutputsRoom {
  /** The chat has artifacts or tasks to list. */
  readonly filled: boolean;
  /** The chat column is wide enough to keep the card open beside the chat. */
  readonly roomy: boolean;
}

export const initialOutputs = (pinned: boolean): OutputsState => ({
  asked: false,
  peek: false,
  pinned,
});

export const outputsShown = (
  state: OutputsState,
  { filled, roomy }: OutputsRoom
): boolean => (roomy ? state.pinned && (filled || state.asked) : state.peek);

export const collapseOutputs = (
  state: OutputsState,
  { roomy }: Pick<OutputsRoom, "roomy">
): OutputsState =>
  roomy
    ? { ...state, asked: false, peek: false, pinned: false }
    : { ...state, peek: false };

export const toggleOutputs = (
  state: OutputsState,
  room: OutputsRoom
): OutputsState => {
  if (outputsShown(state, room)) {
    return collapseOutputs(state, room);
  }
  return room.roomy
    ? { ...state, asked: true, pinned: true }
    : { ...state, peek: true };
};

/** Another chat: the pinned choice carries over, a peek doesn't. */
export const leaveChat = (state: OutputsState): OutputsState => ({
  ...state,
  asked: false,
  peek: false,
});

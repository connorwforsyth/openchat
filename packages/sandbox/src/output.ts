// Command output goes into tool results and the panel's log, so every
// provider caps it the same way: keep the head and the tail (where errors
// usually are) and say that something was dropped.

/** Per stream, per command: plenty for a build log, small enough for a prompt. */
export const MAX_OUTPUT_CHARS = 256 * 1024;

export interface CappedOutput {
  readonly text: string;
  readonly truncated: boolean;
}

export const capOutput = (
  text: string,
  max = MAX_OUTPUT_CHARS
): CappedOutput => {
  if (text.length <= max) {
    return { text, truncated: false };
  }
  const half = Math.floor(max / 2);
  const dropped = text.length - half * 2;
  return {
    text: `${text.slice(0, half)}\n… ${dropped} characters omitted …\n${text.slice(-half)}`,
    truncated: true,
  };
};

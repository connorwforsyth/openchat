// The motion tokens (D28) for JavaScript: timers that must line up with a CSS
// transition (an exit before unmount, an undo window) read these rather than
// repeating numbers. The CSS side is `--motion-*` in styles/globals.css; keep
// the two in step.

export const motionMs = {
  base: 250,
  exit: 150,
  fast: 100,
  instant: 0,
  slow: 350,
} as const;

export type MotionToken = keyof typeof motionMs;

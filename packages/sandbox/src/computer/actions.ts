import type { ComputerHolder } from "@workspace/server/dots/computer-view";
import { err, ok, type Result } from "@workspace/shared/result";
import { z } from "zod";

// A Dot's computer (172): the `computer` tool's actions as xdotool commands
// run inside the desktop sandbox (`apps/sandbox-runner/desktop`). Pure: the
// tool shell runs the command and reads the screenshot it leaves behind.
//
// The model-facing input is one flat object (providers want an object at
// the top of a tool's schema, not a union); it's narrowed here into a
// discriminated union, so every action carries exactly what it needs.

/** The desktop's screen, in the pixels the model's coordinates refer to. */
export const SCREEN = { height: 800, width: 1280 } as const;

/** Where the latest screenshot lands, inside the workspace volume. */
export const SCREENSHOT_PATH = "/work/.computer/screen.jpg";

/**
 * Present while the person watching has taken over: input actions are
 * refused until they give control back. It lives in the desktop's own
 * `/tmp`, so the computer is the source of truth and nothing is held in the
 * web process.
 */
export const CONTROL_FLAG = "/tmp/.user-control";

/** The exit code the command uses for "the person has control". */
export const EXIT_USER_CONTROL = 3;

const ACTIONS = [
  "screenshot",
  "click",
  "double_click",
  "move",
  "type",
  "key",
  "scroll",
  "wait",
  "open_browser",
] as const;

export const computerInputSchema = z.object({
  action: z
    .enum(ACTIONS)
    .describe(
      "screenshot: look at the screen. click/double_click/move: the pointer at x,y. type: text into the focused field. key: a key or chord (`Return`, `ctrl+l`, `ctrl+shift+t`; several separated by spaces). scroll: at x,y. wait: let the page settle. open_browser: start Chromium (or a new tab), optionally at url."
    ),
  amount: z
    .int()
    .min(1)
    .max(20)
    .optional()
    .describe("scroll: how many notches (default 3)"),
  button: z
    .enum(["left", "right", "middle"])
    .optional()
    .describe("click: which button (default left)"),
  direction: z
    .enum(["up", "down", "left", "right"])
    .optional()
    .describe("scroll: which way"),
  keys: z.string().optional().describe("key: e.g. `Return` or `ctrl+l`"),
  seconds: z
    .number()
    .min(0)
    .max(10)
    .optional()
    .describe("wait: how long (default 1)"),
  text: z.string().optional().describe("type: the text to type"),
  url: z.string().optional().describe("open_browser: the page to open"),
  x: z
    .int()
    .optional()
    .describe(`pixels from the left, 0–${SCREEN.width - 1}`),
  y: z
    .int()
    .optional()
    .describe(`pixels from the top, 0–${SCREEN.height - 1}`),
});
export type ComputerInput = z.infer<typeof computerInputSchema>;

const x = z
  .int()
  .min(0)
  .max(SCREEN.width - 1);
const y = z
  .int()
  .min(0)
  .max(SCREEN.height - 1);
/** xdotool keysyms joined by `+`, several separated by spaces. */
const KEYS =
  /^[A-Za-z0-9_]+(\+[A-Za-z0-9_]+)*( [A-Za-z0-9_]+(\+[A-Za-z0-9_]+)*)*$/;

export const computerActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("screenshot") }),
  z.object({
    action: z.literal("click"),
    button: z.enum(["left", "right", "middle"]).default("left"),
    x,
    y,
  }),
  z.object({ action: z.literal("double_click"), x, y }),
  z.object({ action: z.literal("move"), x, y }),
  z.object({ action: z.literal("type"), text: z.string().min(1).max(4000) }),
  z.object({
    action: z.literal("key"),
    keys: z.string().max(200).regex(KEYS, "keys like `Return` or `ctrl+l`"),
  }),
  z.object({
    action: z.literal("scroll"),
    amount: z.int().min(1).max(20).default(3),
    direction: z.enum(["up", "down", "left", "right"]),
    x,
    y,
  }),
  z.object({
    action: z.literal("wait"),
    seconds: z.number().min(0).max(10).default(1),
  }),
  z.object({
    action: z.literal("open_browser"),
    url: z.url({ protocol: /^https?$/ }).optional(),
  }),
]);
export type ComputerAction = z.infer<typeof computerActionSchema>;

/** Narrows the flat input to one action; the message says what's wrong. Pure. */
export const toComputerAction = (
  input: ComputerInput
): Result<ComputerAction, string> => {
  const parsed = computerActionSchema.safeParse(input);
  if (parsed.success) {
    return ok(parsed.data);
  }
  const [issue] = parsed.error.issues;
  const where = issue?.path.join(".") || "input";
  return err(`${input.action}: ${where} ${issue?.message ?? "is invalid"}`);
};

/** One argument for `bash -c`, single-quoted. Pure. */
export const shellQuote = (value: string): string =>
  `'${value.replaceAll("'", "'\\''")}'`;

const BUTTONS = { left: 1, middle: 2, right: 3 } as const;
const WHEEL = { down: 5, left: 6, right: 7, up: 4 } as const;

/** How long the screen gets to settle before the screenshot, in seconds. */
const SETTLE = { input: 0.4, page: 1.5 } as const;

/** Whether an action changes anything (and so is refused while the person drives). */
export const isInputAction = (action: ComputerAction): boolean =>
  action.action !== "screenshot" && action.action !== "wait";

/** The xdotool part of an action, without the screenshot. Pure. */
export const actionCommand = (action: ComputerAction): string => {
  switch (action.action) {
    case "screenshot":
      return "true";
    case "click":
      return `xdotool mousemove --sync ${action.x} ${action.y} click ${BUTTONS[action.button]}`;
    case "double_click":
      return `xdotool mousemove --sync ${action.x} ${action.y} click --repeat 2 --delay 120 1`;
    case "move":
      return `xdotool mousemove --sync ${action.x} ${action.y}`;
    case "type":
      return `xdotool type --delay 20 -- ${shellQuote(action.text)}`;
    case "key":
      return `xdotool key --delay 60 -- ${action.keys}`;
    case "scroll":
      return `xdotool mousemove --sync ${action.x} ${action.y} click --repeat ${action.amount} --delay 40 ${WHEEL[action.direction]}`;
    case "wait":
      return `sleep ${action.seconds}`;
    case "open_browser":
      return `open-browser ${shellQuote(action.url ?? "about:blank")}`;
    default:
      return action satisfies never;
  }
};

/**
 * The whole command for one action: refuse input while the person has
 * control, do the action, let the screen settle, then leave a screenshot at
 * `SCREENSHOT_PATH` for the tool to read. Pure.
 */
export const computerCommand = (action: ComputerAction): string => {
  const settle = action.action === "open_browser" ? SETTLE.page : SETTLE.input;
  return [
    isInputAction(action)
      ? `if [ -e ${CONTROL_FLAG} ]; then exit ${EXIT_USER_CONTROL}; fi`
      : undefined,
    "mkdir -p /work/.computer",
    actionCommand(action),
    action.action === "screenshot" || action.action === "wait"
      ? undefined
      : `sleep ${settle}`,
    `scrot --overwrite --quality 70 ${SCREENSHOT_PATH}`,
  ]
    .filter((line): line is string => line !== undefined)
    .join(" && ");
};

/** Hands control to the person (`user`) or back to the agent. Pure. */
export const controlCommand = (holder: ComputerHolder): string =>
  holder === "user" ? `touch ${CONTROL_FLAG}` : `rm -f ${CONTROL_FLAG}`;

/** Prints who has control: `user` or `agent`. */
export const CONTROL_STATUS_COMMAND = `if [ -e ${CONTROL_FLAG} ]; then echo user; else echo agent; fi`;

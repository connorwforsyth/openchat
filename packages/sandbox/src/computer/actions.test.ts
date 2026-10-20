import { describe, expect, it } from "vitest";

import {
  actionCommand,
  CONTROL_FLAG,
  computerCommand,
  controlCommand,
  EXIT_USER_CONTROL,
  SCREENSHOT_PATH,
  shellQuote,
  toComputerAction,
} from "./actions";

const action = (input: Parameters<typeof toComputerAction>[0]) => {
  const parsed = toComputerAction(input);
  if (!parsed.ok) {
    throw new Error(parsed.error);
  }
  return parsed.value;
};

describe("toComputerAction", () => {
  it("narrows the flat input and fills defaults", () => {
    expect(action({ action: "click", x: 10, y: 20 })).toEqual({
      action: "click",
      button: "left",
      x: 10,
      y: 20,
    });
    expect(
      action({ action: "scroll", direction: "down", x: 1, y: 2 })
    ).toMatchObject({ amount: 3 });
  });

  it("says what's missing or out of bounds", () => {
    const missing = toComputerAction({ action: "click", x: 10 });
    expect(missing).toMatchObject({ ok: false });
    expect(!missing.ok && missing.error).toContain("y");
    expect(toComputerAction({ action: "move", x: 5000, y: 1 }).ok).toBe(false);
    expect(toComputerAction({ action: "type" }).ok).toBe(false);
  });

  it("refuses key strings that could escape the command", () => {
    expect(toComputerAction({ action: "key", keys: "ctrl+l" }).ok).toBe(true);
    expect(toComputerAction({ action: "key", keys: "Return Tab" }).ok).toBe(
      true
    );
    expect(toComputerAction({ action: "key", keys: "a; rm -rf /" }).ok).toBe(
      false
    );
    expect(toComputerAction({ action: "key", keys: "$(id)" }).ok).toBe(false);
  });

  it("only opens web pages", () => {
    expect(
      toComputerAction({ action: "open_browser", url: "https://example.com" })
        .ok
    ).toBe(true);
    expect(
      toComputerAction({ action: "open_browser", url: "file:///etc/passwd" }).ok
    ).toBe(false);
  });
});

describe("actionCommand", () => {
  it("maps each action to xdotool", () => {
    expect(actionCommand(action({ action: "click", x: 3, y: 4 }))).toBe(
      "xdotool mousemove --sync 3 4 click 1"
    );
    expect(
      actionCommand(action({ action: "click", button: "right", x: 3, y: 4 }))
    ).toBe("xdotool mousemove --sync 3 4 click 3");
    expect(actionCommand(action({ action: "double_click", x: 3, y: 4 }))).toBe(
      "xdotool mousemove --sync 3 4 click --repeat 2 --delay 120 1"
    );
    expect(actionCommand(action({ action: "move", x: 3, y: 4 }))).toBe(
      "xdotool mousemove --sync 3 4"
    );
    expect(actionCommand(action({ action: "key", keys: "ctrl+l" }))).toBe(
      "xdotool key --delay 60 -- ctrl+l"
    );
    expect(
      actionCommand(
        action({ action: "scroll", amount: 2, direction: "up", x: 5, y: 6 })
      )
    ).toBe("xdotool mousemove --sync 5 6 click --repeat 2 --delay 40 4");
    expect(actionCommand(action({ action: "wait", seconds: 2 }))).toBe(
      "sleep 2"
    );
    expect(actionCommand(action({ action: "screenshot" }))).toBe("true");
  });

  it("quotes typed text and urls", () => {
    expect(actionCommand(action({ action: "type", text: "it's $HOME" }))).toBe(
      `xdotool type --delay 20 -- 'it'\\''s $HOME'`
    );
    expect(
      actionCommand(action({ action: "open_browser", url: "https://a.b/?q=1" }))
    ).toBe("open-browser 'https://a.b/?q=1'");
    expect(actionCommand(action({ action: "open_browser" }))).toBe(
      "open-browser 'about:blank'"
    );
  });
});

describe("computerCommand", () => {
  it("refuses input while the person has control, then screenshots", () => {
    const command = computerCommand(action({ action: "click", x: 1, y: 2 }));
    expect(command.startsWith(`if [ -e ${CONTROL_FLAG} ]`)).toBe(true);
    expect(command).toContain(`exit ${EXIT_USER_CONTROL}`);
    expect(command.endsWith(SCREENSHOT_PATH)).toBe(true);
  });

  it("lets the agent look while the person drives", () => {
    const command = computerCommand(action({ action: "screenshot" }));
    expect(command).not.toContain(CONTROL_FLAG);
    expect(command).toContain("scrot");
  });
});

describe("control", () => {
  it("never leaves viewer input on while the agent thinks it drives", () => {
    // The agent stands down on the flag, so the flag is set before input
    // turns on, and cleared only after input is off.
    expect(controlCommand("user")).toBe(
      `touch ${CONTROL_FLAG} && if pgrep -x x11vnc >/dev/null; then x11vnc -sync -R noviewonly; fi`
    );
    expect(controlCommand("agent")).toBe(
      `if pgrep -x x11vnc >/dev/null; then x11vnc -sync -R viewonly; fi && rm -f ${CONTROL_FLAG}`
    );
  });

  it("shellQuote survives single quotes", () => {
    expect(shellQuote("a'b")).toBe(`'a'\\''b'`);
  });
});

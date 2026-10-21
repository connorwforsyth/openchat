import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
  // Runs the real command in sh against a stand-in x11vnc that records
  // whether the agent's stand-down flag was set when input was switched,
  // with exec's 5 s limit. `timeout` is a stand-in too: macOS has none.
  const switchControl = (
    holder: "agent" | "user",
    { flagged, vnc }: { flagged: boolean; vnc: "fails" | "hangs" | "works" }
  ) => {
    const dir = mkdtempSync(join(tmpdir(), "computer-control-"));
    const flag = join(dir, "user-control");
    const seen = join(dir, "seen");
    writeFileSync(join(dir, "pgrep"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    const end = { fails: "exit 1", hangs: "exec sleep 30", works: "exit 0" };
    writeFileSync(
      join(dir, "x11vnc"),
      `#!/bin/sh\nif [ -e ${flag} ]; then echo "$3 flagged" >> ${seen}; else echo "$3 clear" >> ${seen}; fi\n${end[vnc]}\n`,
      { mode: 0o755 }
    );
    writeFileSync(
      join(dir, "timeout"),
      [
        "#!/bin/sh",
        "limit=$1; shift",
        '"$@" & pid=$!',
        '( sleep "$limit"; kill "$pid" ) </dev/null >/dev/null 2>&1 & watcher=$!',
        'wait "$pid"; status=$?',
        'kill "$watcher" 2>/dev/null',
        '[ "$status" -gt 128 ] && exit 124',
        'exit "$status"',
        "",
      ].join("\n"),
      { mode: 0o755 }
    );
    if (flagged) {
      writeFileSync(flag, "");
    }
    const ran = spawnSync(
      "sh",
      ["-c", controlCommand(holder).replaceAll(CONTROL_FLAG, flag)],
      { env: { PATH: `${dir}:${process.env.PATH ?? ""}` }, timeout: 5000 }
    );
    const result = {
      flagged: existsSync(flag),
      seen: existsSync(seen) ? readFileSync(seen, "utf8").trim() : "",
      status: ran.status,
    };
    rmSync(dir, { force: true, recursive: true });
    return result;
  };

  it("sets the flag before viewer input turns on, and clears it only once input is off", () => {
    expect(switchControl("user", { flagged: false, vnc: "works" })).toEqual({
      flagged: true,
      seen: "noviewonly flagged",
      status: 0,
    });
    expect(switchControl("agent", { flagged: true, vnc: "works" })).toEqual({
      flagged: false,
      seen: "viewonly flagged",
      status: 0,
    });
  });

  it("leaves the agent driving when viewer input won't turn on", () => {
    expect(
      switchControl("user", { flagged: false, vnc: "fails" })
    ).toMatchObject({ flagged: false, status: 1 });
  });

  it("leaves the agent driving when switching viewer input hangs past exec's limit", () => {
    expect(
      switchControl("user", { flagged: false, vnc: "hangs" })
    ).toMatchObject({ flagged: false, status: 1 });
  });

  it("keeps the agent stood down when viewer input won't turn off", () => {
    expect(
      switchControl("agent", { flagged: true, vnc: "fails" })
    ).toMatchObject({ flagged: true, status: 1 });
  });

  it("shellQuote survives single quotes", () => {
    expect(shellQuote("a'b")).toBe(`'a'\\''b'`);
  });
});

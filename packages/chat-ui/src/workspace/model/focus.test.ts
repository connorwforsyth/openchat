import { afterEach, describe, expect, it } from "vitest";

import {
  containsComposed,
  deepActiveElement,
  type EscapeAction,
  escapeAction,
  focusReturnTarget,
  takesFocusOnOpen,
} from "./focus";

// The panel frame's focus rules (070) over real DOM: a frame with a button,
// an input and an editor inside a shadow root (like the Workspace editor),
// and a trigger and a portalled menu outside it.

const setup = () => {
  const trigger = document.createElement("button");
  trigger.textContent = "Workspace";
  const frame = document.createElement("div");
  frame.tabIndex = -1;
  const button = document.createElement("button");
  const input = document.createElement("input");
  const host = document.createElement("div");
  const shadow = host.attachShadow({ mode: "open" });
  const editor = document.createElement("div");
  editor.contentEditable = "true";
  shadow.append(editor);
  frame.append(button, input, host);
  const menu = document.createElement("div");
  menu.setAttribute("role", "menu");
  const item = document.createElement("div");
  item.setAttribute("role", "menuitem");
  item.tabIndex = -1;
  menu.append(item);
  document.body.append(trigger, frame, menu);
  return { button, editor, frame, host, input, item, trigger };
};

/**
 * What the frame's listener decides for a key pressed on `target`. Decided
 * during dispatch, as a real listener does: an event's composed path is
 * empty once dispatch is over.
 */
const escapeOn = (
  target: Element,
  frame: Element,
  { handled = false, key = "Escape" } = {}
): EscapeAction => {
  let action: EscapeAction | null = null;
  const handle = (event: Event) => {
    if (handled) {
      event.preventDefault();
    }
  };
  const listen = (event: Event) => {
    action = escapeAction(event as KeyboardEvent, frame);
  };
  target.addEventListener("keydown", handle);
  document.addEventListener("keydown", listen);
  target.dispatchEvent(
    new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      composed: true,
      key,
    })
  );
  target.removeEventListener("keydown", handle);
  document.removeEventListener("keydown", listen);
  if (!action) {
    throw new Error("no keydown");
  }
  return action;
};

afterEach(() => {
  document.body.replaceChildren();
});

describe("where focus is", () => {
  it("looks inside shadow roots, where the editor is", () => {
    const { editor, host } = setup();
    editor.focus();
    expect(document.activeElement).toBe(host);
    expect(deepActiveElement(document)).toBe(editor);
  });

  it("counts a node in a shadow root as inside its host's ancestors", () => {
    const { editor, frame, item } = setup();
    expect(frame.contains(editor)).toBe(false);
    expect(containsComposed(frame, editor)).toBe(true);
    expect(containsComposed(frame, item)).toBe(false);
  });
});

describe("opening the panel", () => {
  it("takes focus from a button or from nowhere", () => {
    const { trigger } = setup();
    expect(takesFocusOnOpen(trigger)).toBe(true);
    expect(takesFocusOnOpen(document.body)).toBe(true);
    expect(takesFocusOnOpen(null)).toBe(true);
  });

  it("leaves someone typing alone (the agent's page opening the Preview by itself)", () => {
    const { editor, input } = setup();
    expect(takesFocusOnOpen(input)).toBe(false);
    expect(takesFocusOnOpen(editor)).toBe(false);
  });
});

describe("Escape in the panel", () => {
  it("closes the panel from a control", () => {
    const { button, frame } = setup();
    expect(escapeOn(button, frame)).toBe("close");
    expect(escapeOn(frame, frame)).toBe("close");
  });

  it("leaves a field first, the editor's too, through its shadow root", () => {
    const { editor, frame, input } = setup();
    expect(escapeOn(input, frame)).toBe("leave-field");
    expect(escapeOn(editor, frame)).toBe("leave-field");
  });

  it("does nothing once something inside used it, or for a portalled menu", () => {
    const { button, frame, item } = setup();
    expect(escapeOn(button, frame, { handled: true })).toBe("ignore");
    expect(escapeOn(item, frame)).toBe("ignore");
    expect(escapeOn(button, frame, { key: "a" })).toBe("ignore");
  });
});

describe("closing the panel", () => {
  it("hands focus back to what opened it when focus was inside", () => {
    const { button, frame, trigger } = setup();
    button.focus();
    expect(
      focusReturnTarget({
        active: deepActiveElement(document),
        fallback: null,
        frame,
        opener: trigger,
      })
    ).toBe(trigger);
  });

  it("does the same when focus fell to the page", () => {
    const { frame, trigger } = setup();
    expect(
      focusReturnTarget({
        active: document.body,
        fallback: null,
        frame,
        opener: trigger,
      })
    ).toBe(trigger);
  });

  it("goes to the toggle when the panel was opened from nowhere (S)", () => {
    const { button, frame, trigger } = setup();
    button.focus();
    expect(
      focusReturnTarget({
        active: button,
        fallback: trigger,
        frame,
        opener: document.body,
      })
    ).toBe(trigger);
  });

  it("leaves focus that's already somewhere else (the toggle was clicked)", () => {
    const { frame, input, trigger } = setup();
    const elsewhere = document.createElement("button");
    document.body.append(elsewhere);
    elsewhere.focus();
    expect(
      focusReturnTarget({
        active: elsewhere,
        fallback: trigger,
        frame,
        opener: input,
      })
    ).toBeNull();
  });

  it("skips an opener that's gone or disabled", () => {
    const { button, frame, trigger } = setup();
    const gone = document.createElement("button");
    button.focus();
    expect(
      focusReturnTarget({
        active: button,
        fallback: trigger,
        frame,
        opener: gone,
      })
    ).toBe(trigger);
    trigger.disabled = true;
    expect(
      focusReturnTarget({
        active: button,
        fallback: trigger,
        frame,
        opener: gone,
      })
    ).toBeNull();
  });
});

import { cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";

import { renderWithI18n } from "../testing/render";
import {
  clockOf,
  type PresenterMessage,
  PresenterWindow,
  presenterChannelName,
  presenterKeyAction,
  stepToward,
} from "./presenter";

// The presenter window (n2): it joins a presenting session over a
// BroadcastChannel, shows where the audience is, and sends its keys back.

const ONE_MINUTE_IN = /^1:0\d$/;

afterEach(cleanup);

describe("stepToward", () => {
  it("moves forward or back through slides and their steps, and stops when there", () => {
    expect(stepToward({ slide: 0, step: 0 }, { slide: 2, step: 0 })).toBe(
      "next"
    );
    expect(stepToward({ slide: 2, step: 1 }, { slide: 2, step: 0 })).toBe(
      "previous"
    );
    expect(stepToward({ slide: 3, step: 0 }, { slide: 2, step: 2 })).toBe(
      "previous"
    );
    expect(stepToward({ slide: 2, step: 2 }, { slide: 2, step: 2 })).toBeNull();
  });
});

describe("clockOf", () => {
  it("reads minutes and seconds, and hours once there are any", () => {
    expect(clockOf(0)).toBe("0:00");
    expect(clockOf(75_400)).toBe("1:15");
    expect(clockOf(3_723_000)).toBe("1:02:03");
    expect(clockOf(-5)).toBe("0:00");
  });
});

describe("presenterKeyAction", () => {
  it("steps with the arrows and space, and Escape ends presenting", () => {
    expect([" ", "ArrowRight", "ArrowLeft"].map(presenterKeyAction)).toEqual([
      "next",
      "next",
      "previous",
    ]);
    expect(presenterKeyAction("Escape")).toBe("exit");
    expect(presenterKeyAction("x")).toBeNull();
  });
});

describe("PresenterWindow", () => {
  it("asks for the deck, shows the slide, notes and timer, and sends its keys back", async () => {
    const session = "test-session";
    const panel = new BroadcastChannel(presenterChannelName(session));
    const heard: PresenterMessage[] = [];
    panel.onmessage = (event: MessageEvent) => heard.push(event.data);
    renderWithI18n(
      <PresenterWindow runtimeOrigin="http://127.0.0.1:9" session={session} />
    );
    await waitFor(() => expect(heard).toContainEqual({ type: "hello" }));
    panel.postMessage({
      content: '{"title":"Deck","slides":[]}',
      startedAt: Date.now() - 65_000,
      title: "Deck",
      type: "deck",
    } satisfies PresenterMessage);
    panel.postMessage({
      notes: "Breathe.",
      slide: 1,
      slides: 3,
      step: 0,
      type: "position",
    } satisfies PresenterMessage);
    await waitFor(() => expect(screen.getByText("Slide 2 of 3")).toBeTruthy());
    expect(screen.getByLabelText("Speaker notes").textContent).toBe("Breathe.");
    expect(screen.getByRole("timer").textContent).toMatch(ONE_MINUTE_IN);
    expect(screen.getByTitle("Next slide")).toBeTruthy();
    await userEvent.keyboard("{ArrowRight}");
    await waitFor(() =>
      expect(heard).toContainEqual({ action: "next", type: "command" })
    );
    panel.close();
  });
});

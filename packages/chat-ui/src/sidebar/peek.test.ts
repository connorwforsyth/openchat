import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PEEK_CLOSE_DELAY_MS } from "../model/layout";
import { createPeekController, isPeekBusy, type PeekTimers } from "./peek";

// The peek's timing (071): open on the edge at once, close 500ms after the
// pointer leaves, not while a menu or text field inside is in use.

const timers: PeekTimers = {
  clear: (handle) => clearTimeout(handle),
  set: (run, ms) => setTimeout(run, ms),
};

describe("createPeekController", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const setup = (busy = { value: false }) => {
    const onOpenChange = vi.fn();
    const peek = createPeekController({
      isBusy: () => busy.value,
      onOpenChange,
      timers,
    });
    return { busy, onOpenChange, peek };
  };

  it("opens at once and closes 500ms after the pointer leaves", () => {
    const { onOpenChange, peek } = setup();
    peek.enter();
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
    peek.leave();
    vi.advanceTimersByTime(PEEK_CLOSE_DELAY_MS - 1);
    expect(onOpenChange).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it("stays when the pointer comes back in time", () => {
    const { onOpenChange, peek } = setup();
    peek.enter();
    peek.leave();
    vi.advanceTimersByTime(PEEK_CLOSE_DELAY_MS - 100);
    peek.enter();
    vi.advanceTimersByTime(PEEK_CLOSE_DELAY_MS * 4);
    expect(onOpenChange).toHaveBeenCalledTimes(1);
  });

  it("waits while something inside is in use, then closes", () => {
    const { busy, onOpenChange, peek } = setup({ value: true });
    peek.enter();
    peek.leave();
    vi.advanceTimersByTime(PEEK_CLOSE_DELAY_MS * 3);
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
    busy.value = false;
    vi.advanceTimersByTime(PEEK_CLOSE_DELAY_MS);
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it("does nothing on leave when it isn't open, and closes at once on close()", () => {
    const { onOpenChange, peek } = setup();
    peek.leave();
    vi.advanceTimersByTime(PEEK_CLOSE_DELAY_MS);
    expect(onOpenChange).not.toHaveBeenCalled();
    peek.enter();
    peek.close();
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it("drops a pending close when disposed", () => {
    const { onOpenChange, peek } = setup();
    peek.enter();
    peek.leave();
    peek.dispose();
    vi.advanceTimersByTime(PEEK_CLOSE_DELAY_MS);
    expect(onOpenChange).toHaveBeenCalledTimes(1);
  });
});

describe("isPeekBusy", () => {
  const sidebarWith = (html: string) => {
    const element = document.createElement("aside");
    element.innerHTML = html;
    return element;
  };

  it("counts a row's open menu", () => {
    expect(
      isPeekBusy(
        sidebarWith(
          '<button aria-haspopup="menu" aria-expanded="true"></button>'
        )
      )
    ).toBe(true);
  });

  // 181's foldable section headers are disclosures, open by default; they
  // kept the peek from ever closing.
  it("ignores an unfolded section header", () => {
    expect(
      isPeekBusy(sidebarWith('<h3><button aria-expanded="true"></button></h3>'))
    ).toBe(false);
  });
});

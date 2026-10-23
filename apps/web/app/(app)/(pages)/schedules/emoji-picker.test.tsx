import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import { fakeApi, renderWithApi } from "@/app/(app)/_shared/test-harness";

import { EmojiPicker } from "./emoji-picker";

afterEach(cleanup);

describe("EmojiPicker", () => {
  it("picks an emoji from the grid by keyboard and closes", async () => {
    const onChange = vi.fn();
    renderWithApi(<EmojiPicker onChange={onChange} value="⏰" />, fakeApi({}));
    screen.getByRole("button", { name: "Change emoji, now ⏰" }).focus();
    await userEvent.keyboard("{Enter}");
    const bell = await screen.findByRole("button", { name: "Bell" });
    expect(
      screen.getByRole("button", { name: "Alarm clock" }).ariaPressed
    ).toBe("true");
    bell.focus();
    await userEvent.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledWith("🔔");
    await expect
      .poll(() => screen.queryByRole("button", { name: "Bell" }))
      .toBeNull();
  });

  it("keeps a current emoji that isn't in the grid", async () => {
    renderWithApi(<EmojiPicker onChange={vi.fn()} value="🦊" />, fakeApi({}));
    await userEvent.click(
      screen.getByRole("button", { name: "Change emoji, now 🦊" })
    );
    expect(
      (await screen.findByRole("button", { name: "🦊" })).ariaPressed
    ).toBe("true");
  });
});

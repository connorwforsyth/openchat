import { cleanup, screen } from "@testing-library/react";
import { Composer } from "@workspace/composer/components/composer";
import { publicConfig } from "@workspace/contract/fixtures";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderWithI18n } from "../testing/render";
import { chatModeSwitch, showsModes } from "./chat-modes";

afterEach(cleanup);

const composerWith = (chatModes: boolean, offered = true) => {
  const config = { ...publicConfig, chatModes };
  renderWithI18n(
    <Composer
      onSubmit={vi.fn()}
      {...chatModeSwitch(config, showsModes(config, offered), {
        mode: "chat",
        onChange: vi.fn(),
      })}
    />
  );
};

const SWITCH = "Chat or Code mode";

describe("the composer's Chat / Code switch", () => {
  it("is hidden while features.chatModes is off", () => {
    composerWith(false);
    expect(screen.queryByRole("group", { name: SWITCH })).toBeNull();
  });

  it("shows while features.chatModes is on", () => {
    composerWith(true);
    expect(screen.getByRole("group", { name: SWITCH })).toBeTruthy();
  });

  it("stays hidden where the chat is outside it (a Dot's)", () => {
    composerWith(true, false);
    expect(screen.queryByRole("group", { name: SWITCH })).toBeNull();
  });
});

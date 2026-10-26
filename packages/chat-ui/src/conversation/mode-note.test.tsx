import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { renderWithI18n } from "../testing/render";
import { ModeNote, ShowModesContext } from "./mode-note";

afterEach(cleanup);

describe("a message's mode", () => {
  it("shows while the screen offers the Chat / Code switch", () => {
    renderWithI18n(
      <ShowModesContext.Provider value>
        <ModeNote mode="code" />
      </ShowModesContext.Provider>
    );
    expect(screen.getByText("Sent in Code mode")).toBeTruthy();
  });

  it("is hidden while the switch is off (features.chatModes)", () => {
    renderWithI18n(<ModeNote mode="chat" />);
    expect(screen.queryByText("Sent in Chat mode")).toBeNull();
  });
});

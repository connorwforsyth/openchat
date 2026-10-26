import { setupI18n } from "@lingui/core";
import { describe, expect, it, vi } from "vitest";

import { buildContextActions } from "./context-actions";

const i18n = setupI18n({ locale: "en", messages: { en: {} } });

describe("the chat's artifacts in the palette", () => {
  it("offers to show them, on the Artifacts shortcut, when the chat has the list", () => {
    const onOpen = vi.fn();
    const actions = buildContextActions(i18n, { artifacts: { onOpen } });
    const show = actions.find((action) => action.id === "artifacts:open");
    expect(show?.title).toBe("Show this chat's artifacts");
    expect(show?.shortcutId).toBe("panel.artifacts");
    show?.perform();
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it("offers nothing for them off a chat", () => {
    const actions = buildContextActions(i18n, {});
    expect(actions.some((action) => action.id === "artifacts:open")).toBe(
      false
    );
  });
});

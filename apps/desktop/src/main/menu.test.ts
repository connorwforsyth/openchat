import { createI18n } from "@workspace/i18n/catalog";
import { describe, expect, it, vi } from "vitest";

import { menuTemplate } from "./menu";

const i18n = createI18n("en");

describe("menuTemplate", () => {
  it("puts Change Server in the app menu on macOS", () => {
    const changeInstance = vi.fn();
    const [appMenu, ...rest] = menuTemplate({
      actions: { changeInstance },
      appName: "Shell",
      i18n,
      platform: "mac",
    });
    expect(appMenu?.label).toBe("Shell");
    const items = Array.isArray(appMenu?.submenu) ? appMenu.submenu : [];
    const item = items.find((entry) => entry.id === "change-instance");
    expect(item?.label).toBe("Change Server…");
    expect(rest.map((menu) => menu.role)).toEqual([
      "editMenu",
      "viewMenu",
      "windowMenu",
    ]);
  });

  it("puts it in the File menu elsewhere", () => {
    const [file] = menuTemplate({
      actions: { changeInstance: vi.fn() },
      appName: "Shell",
      i18n,
      platform: "win",
    });
    expect(file?.role).toBe("fileMenu");
    const items = Array.isArray(file?.submenu) ? file.submenu : [];
    expect(items[0]?.id).toBe("change-instance");
  });
});

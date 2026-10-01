import { describe, expect, it } from "vitest";

import { hasNativeMaterial } from "./desktop-shell";

const MAC_CHROME =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36";
const WINDOWS_CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36";

describe("hasNativeMaterial", () => {
  it("is the desktop app on macOS", () => {
    expect(hasNativeMaterial(`${MAC_CHROME} DesktopShell/0.0.1`)).toBe(true);
  });

  it("isn't a browser, or the desktop app elsewhere", () => {
    expect(hasNativeMaterial(MAC_CHROME)).toBe(false);
    expect(hasNativeMaterial(`${WINDOWS_CHROME} DesktopShell/0.0.1`)).toBe(
      false
    );
    expect(hasNativeMaterial(null)).toBe(false);
  });
});

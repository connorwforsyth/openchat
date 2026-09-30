import { ok } from "@workspace/shared/result";
import { describe, expect, it } from "vitest";

import { resolveSandboxPath, resolveWorkspacePath } from "./paths";
import { STATIC_PREVIEW_SCRIPT_PATH } from "./tools/static-preview";

const invalid = expect.objectContaining({
  error: expect.objectContaining({ type: "invalid" }),
  ok: false,
});

describe("resolveWorkspacePath", () => {
  it("keeps paths inside /work", () => {
    expect(resolveWorkspacePath("a.txt")).toEqual(ok("/work/a.txt"));
    expect(resolveWorkspacePath("./src/../b.ts")).toEqual(ok("/work/b.ts"));
    expect(resolveWorkspacePath("/work/src/c.ts")).toEqual(
      ok("/work/src/c.ts")
    );
  });

  it.each([
    ["climbs out with ..", "../etc/passwd"],
    ["climbs out from deeper", "src/../../etc/passwd"],
    ["climbs past the root", "../../../../x"],
    ["is absolute elsewhere", "/etc/passwd"],
    ["only looks like the workdir", "/workspace/a.txt"],
    ["shares the workdir's prefix", "/workx/a"],
    ["leaves through an absolute ..", "/work/../etc/passwd"],
    ["names the workspace itself", "/work"],
    ["names the workspace relatively", "."],
    ["has a NUL byte", "a.txt\0.png"],
    ["has a newline", "a\nb.txt"],
    ["has a C1 control character", "a\u0085b.txt"],
    ["is empty", ""],
    ["is blank", "   "],
  ])("refuses a path that %s", (_why, path) => {
    expect(resolveWorkspacePath(path)).toMatchObject(invalid);
  });
});

describe("resolveSandboxPath", () => {
  // The providers' own rule stays loose: internal writes such as the static
  // preview's server script live outside /work.
  it("allows absolute paths anywhere below /", () => {
    expect(resolveSandboxPath(STATIC_PREVIEW_SCRIPT_PATH)).toEqual(
      ok(STATIC_PREVIEW_SCRIPT_PATH)
    );
    expect(resolveSandboxPath("a.txt")).toEqual(ok("/work/a.txt"));
  });

  it("refuses to climb above / and NUL bytes", () => {
    expect(resolveSandboxPath("/../x")).toMatchObject({ ok: false });
    expect(resolveSandboxPath("a\0b")).toMatchObject({ ok: false });
  });
});

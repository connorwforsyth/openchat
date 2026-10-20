import { describe, expect, it } from "vitest";

import { createMemoryAvatarStore } from "./avatar-store.memory";

describe("createMemoryAvatarStore", () => {
  it("finds nothing until a key is put, then returns the same URL", async () => {
    const store = createMemoryAvatarStore();
    expect(await store.find("microsoft/a/1")).toBeUndefined();

    const put = await store.put(
      "microsoft/a/1",
      new Uint8Array([1]),
      "image/png"
    );

    expect(put).toEqual({ ok: true, value: "memory://avatars/microsoft/a/1" });
    expect(await store.find("microsoft/a/1")).toBe(put.ok ? put.value : "");
    expect(store.avatars.get("microsoft/a/1")?.contentType).toBe("image/png");
  });
});

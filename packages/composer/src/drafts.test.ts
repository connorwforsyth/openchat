import { fixtureId } from "@workspace/contract/fixtures";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { textToDoc } from "./doc";
import {
  createDraftSaver,
  DRAFT_SAVE_DELAY_MS,
  draftDoc,
  isEmptyDraft,
} from "./drafts";
import { type Draft, draftNodeSchema, parseDraft } from "./ports/draft-store";
import { createMemoryDraftStore } from "./ports/draft-store.memory";
import {
  createStorageDraftStore,
  type StorageLike,
} from "./ports/draft-store.storage";

const draftOf = (text: string, skills: Draft["skills"] = []): Draft => ({
  doc: draftNodeSchema.parse(textToDoc(text)),
  skills,
  templateId: null,
  version: 1,
});

const haiku = { id: fixtureId("libraryItem", 40), name: "Haiku" };

describe("parseDraft", () => {
  it("reads version 1 and nothing it doesn't know", () => {
    const draft = draftOf("hello", [haiku]);
    expect(parseDraft(JSON.parse(JSON.stringify(draft)))).toEqual(draft);
    expect(parseDraft({ ...draft, version: 2 })).toBeNull();
    expect(parseDraft({ doc: "hello" })).toBeNull();
    expect(parseDraft(null)).toBeNull();
  });

  it("keeps mention nodes", () => {
    const doc = {
      content: [
        {
          content: [
            {
              attrs: { id: "src/app.ts", kind: "file", label: "app.ts" },
              type: "mention",
            },
            { text: " look", type: "text" },
          ],
          type: "paragraph",
        },
      ],
      type: "doc",
    };
    expect(draftDoc(doc)).toEqual(doc);
  });
});

describe("isEmptyDraft", () => {
  it("is empty with no words and no skills", () => {
    expect(isEmptyDraft(draftOf("  "))).toBe(true);
    expect(isEmptyDraft(draftOf("hi"))).toBe(false);
    expect(isEmptyDraft(draftOf("", [haiku]))).toBe(false);
  });
});

describe("createDraftSaver", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("writes once typing pauses, the latest draft", () => {
    const store = createMemoryDraftStore();
    const saver = createDraftSaver(store);
    let text = "h";
    saver.schedule("c1", () => draftOf(text));
    text = "hello";
    saver.schedule("c1", () => draftOf(text));
    vi.advanceTimersByTime(DRAFT_SAVE_DELAY_MS - 1);
    expect(store.writes).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(store.writes).toEqual([
      { draft: draftOf("hello"), key: "c1", type: "save" },
    ]);
  });

  it("writes what's pending at once on flush, and before another key's", () => {
    const store = createMemoryDraftStore();
    const saver = createDraftSaver(store);
    saver.schedule("c1", () => draftOf("one"));
    saver.schedule("c2", () => draftOf("two"));
    expect(store.writes.map((write) => write.key)).toEqual(["c1"]);
    saver.flush();
    expect(store.writes.map((write) => write.key)).toEqual(["c1", "c2"]);
    vi.runAllTimers();
    expect(store.writes).toHaveLength(2);
  });

  it("clears an emptied draft, and forgets a sent one at once", () => {
    const store = createMemoryDraftStore({ c1: draftOf("old") });
    const saver = createDraftSaver(store);
    saver.schedule("c1", () => draftOf(""));
    saver.flush();
    expect(store.writes).toEqual([{ key: "c1", type: "clear" }]);

    saver.schedule("c2", () => draftOf("sending"));
    saver.discard("c2");
    vi.runAllTimers();
    expect(store.writes.at(-1)).toEqual({ key: "c2", type: "clear" });
    expect(store.load("c2")).toEqual({ ok: true, value: null });
  });

  it("doesn't write back a draft it just read", () => {
    const store = createMemoryDraftStore({ c1: draftOf("kept") });
    const saver = createDraftSaver(store);
    expect(saver.load("c1")).toEqual(draftOf("kept"));
    saver.schedule("c1", () => draftOf("kept"));
    saver.flush();
    expect(store.writes).toEqual([]);
  });
});

describe("createStorageDraftStore", () => {
  const fakeStorage = (): StorageLike & {
    readonly data: Map<string, string>;
  } => {
    const data = new Map<string, string>();
    return {
      data,
      getItem: (key) => data.get(key) ?? null,
      removeItem: (key) => {
        data.delete(key);
      },
      setItem: (key, value) => {
        data.set(key, value);
      },
    };
  };

  it("keeps each draft in its own entry under the person's scope", () => {
    const storage = fakeStorage();
    const ada = createStorageDraftStore(() => storage, "ada");
    const bo = createStorageDraftStore(() => storage, "bo");
    expect(ada.save("c1", draftOf("mine")).ok).toBe(true);
    expect([...storage.data.keys()]).toEqual(["composer:draft:ada:c1"]);
    expect(ada.load("c1")).toEqual({ ok: true, value: draftOf("mine") });
    expect(bo.load("c1")).toEqual({ ok: true, value: null });
    ada.clear("c1");
    expect(storage.data.size).toBe(0);
  });

  it("reads corrupt or unknown entries as no draft", () => {
    const storage = fakeStorage();
    const store = createStorageDraftStore(() => storage, "ada");
    storage.data.set("composer:draft:ada:c1", "{not json");
    storage.data.set("composer:draft:ada:c2", '{"version":9}');
    expect(store.load("c1")).toEqual({ ok: true, value: null });
    expect(store.load("c2")).toEqual({ ok: true, value: null });
  });

  it("works without storage (the server) and when it's full", () => {
    const none = createStorageDraftStore(() => null, "ada");
    expect(none.load("c1")).toEqual({ ok: true, value: null });
    expect(none.save("c1", draftOf("x")).ok).toBe(false);

    const full = createStorageDraftStore(
      () => ({
        ...fakeStorage(),
        setItem: () => {
          throw new DOMException("full", "QuotaExceededError");
        },
      }),
      "ada"
    );
    const saved = full.save("c1", draftOf("x"));
    expect(saved).toEqual({
      error: { message: "full", type: "unavailable" },
      ok: false,
    });
  });

  it("round-trips through the browser's localStorage", () => {
    const store = createStorageDraftStore(() => localStorage, "test-147");
    store.save("c1", draftOf("real", [haiku]));
    expect(store.load("c1")).toEqual({
      ok: true,
      value: draftOf("real", [haiku]),
    });
    store.clear("c1");
    expect(localStorage.getItem("composer:draft:test-147:c1")).toBeNull();
  });
});

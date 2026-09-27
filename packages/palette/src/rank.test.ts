import { describe, expect, it } from "vitest";

import { foldText, rankEntries, scoreText } from "./rank";

describe("scoreText", () => {
  it("orders exact > prefix > word prefix > substring > fuzzy", () => {
    const scores = [
      scoreText("new chat", "New chat"),
      scoreText("new", "New chat"),
      scoreText("chat", "New chat"),
      scoreText("ew ch", "New chat"),
      scoreText("nwcht", "New chat"),
    ];
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect(new Set(scores).size).toBe(scores.length);
    expect(scoreText("xyz", "New chat")).toBe(0);
  });

  it("ignores case and accents", () => {
    expect(foldText("Résumé")).toBe("resume");
    expect(scoreText("resume", "Résumé review")).toBeGreaterThan(0.8);
  });

  it("finds every word of a multi-word query in any order", () => {
    expect(scoreText("chat new", "New chat")).toBe(0.5);
  });
});

describe("rankEntries", () => {
  const entries = [
    { title: "Toggle the sidebar" },
    { title: "New chat" },
    { keywords: ["dark", "light"], title: "Appearance" },
    { subtitle: "Switch model", title: "Model picker" },
  ];

  it("keeps the given order for an empty query", () => {
    expect(rankEntries("", entries)).toEqual(entries);
    expect(rankEntries(" ", entries, 2)).toEqual(entries.slice(0, 2));
  });

  it("drops non-matches and ranks titles above keywords", () => {
    expect(rankEntries("dark", entries).map((e) => e.title)).toEqual([
      "Appearance",
    ]);
    expect(rankEntries("new", entries)[0]?.title).toBe("New chat");
  });

  it("breaks ties by the given order", () => {
    const tied = [{ title: "Chat one" }, { title: "Chat two" }];
    expect(rankEntries("chat", tied)).toEqual(tied);
  });
});

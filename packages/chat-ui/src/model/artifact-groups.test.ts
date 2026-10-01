import { describe, expect, it } from "vitest";

import { artifactGroupFor, groupArtifacts } from "./artifact-groups";

const now = new Date(2026, 9, 2, 15, 0);
const at = (month: number, day: number, hour = 12) =>
  new Date(2026, month, day, hour).getTime();

describe("artifactGroupFor", () => {
  it("names today, yesterday, the last week, then the month", () => {
    expect(artifactGroupFor(at(9, 2, 1), now)).toEqual({ type: "today" });
    expect(artifactGroupFor(at(9, 1, 23), now)).toEqual({
      type: "yesterday",
    });
    expect(artifactGroupFor(at(8, 26), now)).toEqual({
      type: "previous7Days",
    });
    expect(artifactGroupFor(at(8, 2), now)).toEqual({
      month: 8,
      type: "month",
      year: 2026,
    });
  });
});

describe("groupArtifacts", () => {
  it("keeps the order it's given, one group per bucket", () => {
    const items = [
      { id: "a", time: at(9, 2) },
      { id: "b", time: at(8, 3) },
      { id: "c", time: at(9, 1) },
      { id: "d", time: at(8, 20) },
    ];
    const groups = groupArtifacts(items, (item) => item.time, now);
    expect(
      groups.map((group) => [group.id, group.items.map((item) => item.id)])
    ).toEqual([
      ["today", ["a"]],
      ["2026-9", ["b", "d"]],
      ["yesterday", ["c"]],
    ]);
  });
});

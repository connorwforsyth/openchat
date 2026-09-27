import {
  agentItem,
  fixtureId,
  org,
  teamPlatform,
} from "@workspace/contract/fixtures";
import type { LibraryItem } from "@workspace/contract/schemas/library";
import { describe, expect, it } from "vitest";

import { contextForOwner, usableAgents } from "./usable-agents";

const item = (n: number, patch: Partial<LibraryItem> = {}): LibraryItem => ({
  ...agentItem,
  id: fixtureId("libraryItem", n),
  name: `Agent ${n}`,
  ...patch,
});

describe("usableAgents", () => {
  it("lists published agents once, from the first tab that has them", () => {
    const team = { id: teamPlatform.id, type: "team" as const };
    const { agents, owners } = usableAgents([
      { items: [item(1), item(2, { latestVersionId: null })], source: "mine" },
      { items: [item(3), item(1)], source: "shared" },
      {
        items: [item(4, { owner: team }), item(5, { kind: "prompt" })],
        source: "libraries",
      },
    ]);
    expect(agents.map((agent) => [agent.name, agent.source])).toEqual([
      ["Agent 1", "mine"],
      ["Agent 3", "shared"],
      ["Agent 4", "libraries"],
    ]);
    expect(owners.get(fixtureId("libraryItem", 4))).toEqual(team);
  });
});

describe("contextForOwner", () => {
  const options = [
    { context: { type: "personal" as const } },
    { context: { id: teamPlatform.id, type: "team" as const } },
    { context: { id: org.id, type: "org" as const } },
  ];

  it("starts a team or org agent's chat in its library's context", () => {
    expect(
      contextForOwner({ id: teamPlatform.id, type: "team" }, options)
    ).toEqual({ id: teamPlatform.id, type: "team" });
    expect(contextForOwner({ id: org.id, type: "org" }, options)).toEqual({
      id: org.id,
      type: "org",
    });
  });

  it("leaves the context alone for a person's agent or a context not on offer", () => {
    expect(
      contextForOwner({ id: agentItem.createdBy, type: "user" }, options)
    ).toBeNull();
    expect(
      contextForOwner(
        { id: fixtureId("team", 99), type: "team" },
        options.slice(0, 1)
      )
    ).toBeNull();
    expect(contextForOwner(undefined, options)).toBeNull();
  });
});

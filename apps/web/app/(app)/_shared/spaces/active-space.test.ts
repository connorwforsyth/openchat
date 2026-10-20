import { fixtureId } from "@workspace/contract/fixtures";
import type { Space } from "@workspace/contract/schemas/spaces";
import type { ChatContext } from "@workspace/contract/schemas/tenancy";
import { describe, expect, it } from "vitest";

import { spaceNamesByChat } from "./active-space";

const space = (
  overrides: Pick<Space, "id" | "isPersonal" | "name" | "type">
): Space => ({
  access: "member",
  canManage: false,
  memberCount: 1,
  myRole: "member",
  orgId: fixtureId("org", 1),
  parent: null,
  ...overrides,
});

const personalOrg = space({
  id: fixtureId("org", 9),
  isPersonal: true,
  name: "Ada's space",
  type: "org",
});
const acme = space({
  id: fixtureId("org", 1),
  isPersonal: false,
  name: "Acme",
  type: "org",
});
const engineering = space({
  id: fixtureId("team", 1),
  isPersonal: false,
  name: "Engineering",
  type: "team",
});
const spaces = [personalOrg, acme, engineering];

const chat = (n: number, context: ChatContext) => ({
  context,
  id: fixtureId("conversation", n),
});

describe("spaceNamesByChat", () => {
  it("names the team or org space a chat lives in", () => {
    const names = spaceNamesByChat(
      [
        chat(1, { id: fixtureId("team", 1), type: "team" }),
        chat(2, { id: fixtureId("org", 1), type: "org" }),
      ],
      spaces
    );
    expect(names.get(fixtureId("conversation", 1))).toBe("Engineering");
    expect(names.get(fixtureId("conversation", 2))).toBe("Acme");
  });

  it("leaves out personal chats and spaces the caller can't see", () => {
    const names = spaceNamesByChat(
      [
        chat(1, { type: "personal" }),
        chat(2, { id: fixtureId("org", 9), type: "org" }),
        chat(3, { id: fixtureId("team", 7), type: "team" }),
      ],
      spaces
    );
    expect(names.size).toBe(0);
  });
});

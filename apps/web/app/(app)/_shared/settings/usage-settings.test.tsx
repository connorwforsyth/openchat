import { cleanup, screen, within } from "@testing-library/react";
import { fixtureId, me } from "@workspace/contract/fixtures";
import type { Space } from "@workspace/contract/schemas/spaces";
import { afterEach, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";

import { fakeApi, renderWithApi } from "@/app/(app)/_shared/test-harness";
import {
  lastDays,
  scopeInput,
  UsageSettings,
  usageScopes,
} from "./usage-settings";

afterEach(() => {
  cleanup();
});

const space = (overrides: Partial<Space>): Space => ({
  access: "member",
  canManage: false,
  id: fixtureId("team", 1),
  isPersonal: false,
  memberCount: 3,
  myRole: "member",
  name: "Platform",
  orgId: fixtureId("org", 1),
  parent: null,
  type: "team",
  ...overrides,
});

const usage = (inputTokens: number, outputTokens: number) => ({
  inputTokens,
  outputTokens,
});

const KEY = fixtureId("providerKey", 1);
const CHAT = fixtureId("conversation", 1);

const rowsBy: Record<string, unknown[]> = {
  conversation: [
    {
      costMicros: 1_200_000,
      key: CHAT,
      label: "Quarterly plan",
      usage: usage(900, 300),
    },
    { costMicros: 30_000, key: "", usage: usage(40, 10) },
  ],
  day: [
    { costMicros: 1_000_000, key: "2026-10-20", usage: usage(800, 200) },
    { costMicros: 230_000, key: "2026-10-19", usage: usage(140, 110) },
  ],
  key: [
    {
      costMicros: 1_200_000,
      key: KEY,
      label: "Team Anthropic",
      usage: usage(900, 300),
    },
    { costMicros: 30_000, key: "", usage: usage(40, 10) },
  ],
  model: [
    {
      costMicros: 1_230_000,
      key: "anthropic:claude-test",
      usage: usage(940, 310),
    },
  ],
};

const summaryApi = (
  rows: Record<string, unknown[]> = rowsBy,
  spaces: readonly Space[] = [space({ isPersonal: true, name: "Personal" })]
) =>
  fakeApi({
    "GET /me": () => me,
    "GET /spaces": () => spaces,
    "GET /usage/summary": ({ search }) => {
      const groupRows = rows[search.get("groupBy") ?? "model"] ?? [];
      return {
        from: search.get("from"),
        principal: { id: me.user.id, type: "user" },
        rows: groupRows,
        to: search.get("to"),
        totalCostMicros: 1_230_000,
      };
    },
  });

describe("UsageSettings", () => {
  it("shows totals, then usage by day, model, chat and key", async () => {
    renderWithApi(<UsageSettings />, summaryApi());

    const stats = await screen.findAllByRole("definition");
    expect(stats.map((stat) => stat.textContent)).toEqual(["1,250", "$1.23"]);
    const byChat = screen.getByRole("heading", { name: "By chat" })
      .parentElement as HTMLElement;
    expect(await within(byChat).findByText("Quarterly plan")).toBeTruthy();
    expect(within(byChat).getByText("Outside chats")).toBeTruthy();
    const byKey = screen.getByRole("heading", { name: "By key" })
      .parentElement as HTMLElement;
    expect(await within(byKey).findByText("Team Anthropic")).toBeTruthy();
    expect(within(byKey).getByText("Server keys")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "By day" })).toBeTruthy();
    expect(screen.getByText("anthropic:claude-test")).toBeTruthy();
  });

  it("names chats and keys the caller can't see without saying what they are", async () => {
    renderWithApi(
      <UsageSettings />,
      summaryApi({
        ...rowsBy,
        conversation: [
          { costMicros: 900, key: CHAT, usage: usage(9, 1) },
          {
            costMicros: 100,
            key: fixtureId("conversation", 2),
            label: "",
            usage: usage(1, 1),
          },
        ],
        key: [{ costMicros: 1000, key: KEY, usage: usage(10, 2) }],
      })
    );

    const byChat = (await screen.findByRole("heading", { name: "By chat" }))
      .parentElement as HTMLElement;
    expect(
      await within(byChat).findByText("A chat you no longer have access to")
    ).toBeTruthy();
    expect(within(byChat).getByText("Untitled chat")).toBeTruthy();
    const byKey = screen.getByRole("heading", { name: "By key" })
      .parentElement as HTMLElement;
    expect(
      await within(byKey).findByText("A key you don't manage")
    ).toBeTruthy();
    expect(within(byKey).queryByText(KEY)).toBeNull();
  });

  it("shows everyone in a space you manage by person, with trace links where given", async () => {
    const acme = space({
      canManage: true,
      id: fixtureId("org", 2),
      name: "Acme",
      type: "org",
    });
    const ada = fixtureId("user", 2);
    renderWithApi(
      <UsageSettings />,
      summaryApi(
        {
          ...rowsBy,
          user: [
            {
              costMicros: 1_000_000,
              key: ada,
              label: "Ada",
              traceUrl: `https://traces.test/users/${ada}`,
              usage: usage(800, 200),
            },
            {
              costMicros: 230_000,
              key: fixtureId("user", 3),
              label: "Grace",
              usage: usage(140, 110),
            },
          ],
        },
        [acme]
      )
    );

    await userEvent.click(
      await screen.findByRole("combobox", { name: "Whose usage" })
    );
    await userEvent.click(
      await screen.findByRole("option", { name: "Everyone in Acme" })
    );
    const byPerson = (await screen.findByRole("heading", { name: "By person" }))
      .parentElement as HTMLElement;
    expect(await within(byPerson).findByText("Grace")).toBeTruthy();
    expect(
      within(byPerson)
        .getByRole("link", { name: "Traces for Ada" })
        .getAttribute("href")
    ).toBe(`https://traces.test/users/${ada}`);
    expect(
      within(byPerson).queryByRole("link", { name: "Traces for Grace" })
    ).toBeNull();
    expect(screen.queryByRole("heading", { name: "By chat" })).toBeNull();
  });

  it("says so when there's no usage", async () => {
    renderWithApi(
      <UsageSettings />,
      fakeApi({
        "GET /me": () => me,
        "GET /spaces": () => [],
        "GET /usage/summary": ({ search }) => ({
          from: search.get("from"),
          principal: { id: me.user.id, type: "user" },
          rows: [],
          to: search.get("to"),
          totalCostMicros: 0,
        }),
      })
    );
    expect(await screen.findByText("No usage in this period.")).toBeTruthy();
  });
});

describe("usageScopes", () => {
  it("offers everyone's usage only in spaces you manage", () => {
    const member = space({ name: "Platform" });
    const managed = space({
      canManage: true,
      id: fixtureId("org", 2),
      name: "Acme",
      type: "org",
    });
    const scopes = usageScopes([
      space({ id: fixtureId("org", 3), isPersonal: true }),
      member,
      managed,
    ]);
    expect(scopes.map((scope) => scope.kind)).toEqual([
      "mine",
      "mine-in",
      "mine-in",
      "everyone-in",
    ]);
    expect(scopeInput(scopes[1] ?? { kind: "mine" }, me.user.id)).toEqual({
      principalId: me.user.id,
      principalType: "user",
      spaceId: member.id,
      spaceType: "team",
    });
    expect(scopeInput(scopes[3] ?? { kind: "mine" }, me.user.id)).toEqual({
      principalId: managed.id,
      principalType: "org",
    });
  });
});

describe("lastDays", () => {
  it("starts at midnight UTC, counting today", () => {
    expect(lastDays(7, new Date("2026-10-21T15:00:00Z"))).toEqual({
      from: "2026-10-15T00:00:00.000Z",
      to: "2026-10-21T15:00:00.000Z",
    });
  });
});

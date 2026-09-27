import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import {
  fixtureId,
  fixtureTime,
  org,
  teamEngineering,
  teamPlatform,
  userAda,
  userBo,
} from "@workspace/contract/fixtures";
import {
  instancePolicySchema,
  type OrgPolicyView,
  orgPolicySchema,
} from "@workspace/contract/schemas/tenancy";
import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import {
  apiError,
  fakeApi,
  renderWithApi,
} from "@/app/(app)/_shared/test-harness";
import { AuditPolicy } from "./audit-policy";
import { MembersAdmin } from "./members-admin";
import { OrgPolicyForm } from "./org-policy-form";
import { TeamsAdmin } from "./teams-admin";
import { UsageAdmin } from "./usage-admin";

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

afterEach(() => {
  cleanup();
});

const orgId = org.id;
const INVITE_TOKEN = "k7Qm2c9Xr1VbN0pLw4Ez8TjYs6HgFdAaUoIiPq3Ke5M";

const view = (stored: object = {}, limits: object = {}): OrgPolicyView => {
  const parsedStored = orgPolicySchema.parse(stored);
  const parsedLimits = instancePolicySchema.parse(limits);
  return {
    adjustments: [],
    effective: parsedStored,
    limits: parsedLimits,
    stored: parsedStored,
  };
};

const PERSONAL_KEYS = /Fall back to personal keys/;
const SAMPLED = /Sampled scoring/;
const KEEP_ON_DEVICE = /Keep a copy on each device/;
const AUDIT = /Let admins read chats/;
const LAST_OWNER = /at least one owner/;
const HAS_SUBTEAMS = /has sub-teams/;

describe("OrgPolicyForm", () => {
  it("locks what the instance forbids and saves the rest", async () => {
    const api = fakeApi({
      "GET /orgs/:id/policy": () =>
        view(
          {},
          {
            chatContext: ["personal", "team"],
            personalKeyFallback: "forbidden",
          }
        ),
      "PUT /orgs/:id/policy": ({ body }) =>
        view((body as { policy: object }).policy, {
          chatContext: ["personal", "team"],
          personalKeyFallback: "forbidden",
        }),
    });
    renderWithApi(<OrgPolicyForm orgId={orgId} />, api);

    const fallback = await screen.findByRole("switch", { name: PERSONAL_KEYS });
    expect(fallback.hasAttribute("data-disabled")).toBe(true);
    expect(screen.getAllByText("Locked by server config").length).toBe(2);
    expect(
      screen.getByText("Some choices don't apply on this server")
    ).toBeTruthy();

    // Unstyled in tests, switches have no box to hit; dispatch the click.
    fireEvent.click(screen.getByRole("switch", { name: SAMPLED }));
    await userEvent.click(screen.getByRole("button", { name: "Save policy" }));
    await waitFor(() =>
      expect(
        api.calls.find((call) => call.route.startsWith("PUT /orgs/"))?.body
      ).toMatchObject({ policy: { sampledScoring: true } })
    );
    expect(await screen.findByText("Saved")).toBeTruthy();
  });
});

describe("OrgPolicyForm persistence", () => {
  it("turns off the on-device cache for shared computers", async () => {
    const api = fakeApi({
      "GET /orgs/:id/policy": () => view(),
      "PUT /orgs/:id/policy": ({ body }) =>
        view((body as { policy: object }).policy),
    });
    renderWithApi(<OrgPolicyForm orgId={orgId} />, api);
    const keep = await screen.findByRole("switch", { name: KEEP_ON_DEVICE });
    expect(keep.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(keep);
    await userEvent.click(screen.getByRole("button", { name: "Save policy" }));
    await waitFor(() =>
      expect(
        api.calls.find((call) => call.route.startsWith("PUT /orgs/"))?.body
      ).toMatchObject({ policy: { persistClientCache: false } })
    );
  });

  it("locks it off when the server forbids it", async () => {
    const api = fakeApi({
      "GET /orgs/:id/policy": () =>
        view({}, { persistClientCache: "forbidden" }),
    });
    renderWithApi(<OrgPolicyForm orgId={orgId} />, api);
    const keep = await screen.findByRole("switch", { name: KEEP_ON_DEVICE });
    expect(keep.hasAttribute("data-disabled")).toBe(true);
    expect(keep.getAttribute("aria-checked")).toBe("false");
  });
});

describe("AuditPolicy", () => {
  const routes = (limits: object, myRole: "owner" | "admin") => ({
    "GET /orgs/:id": () => ({ ...org, myRole }),
    "GET /orgs/:id/policy": () => view({}, limits),
    "PUT /orgs/:id/policy": ({ body }: { body: unknown }) =>
      view((body as { policy: object }).policy, limits),
  });

  it("lets an owner switch it on, and tells members", async () => {
    const api = fakeApi(routes({}, "owner"));
    renderWithApi(<AuditPolicy orgId={orgId} />, api);
    expect(await screen.findByText("Members are told")).toBeTruthy();
    const toggle = await screen.findByRole("switch", { name: AUDIT });
    await waitFor(() =>
      expect(toggle.getAttribute("aria-disabled")).not.toBe("true")
    );
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(
        api.calls.find((call) => call.route.startsWith("PUT"))?.body
      ).toMatchObject({ policy: { auditEnabled: true } })
    );
  });

  it("is read-only for admins and locked when the server forbids it", async () => {
    const { unmount } = renderWithApi(
      <AuditPolicy orgId={orgId} />,
      fakeApi(routes({}, "admin"))
    );
    expect(
      await screen.findByText("Only the org's owners can change this.")
    ).toBeTruthy();
    unmount();
    renderWithApi(
      <AuditPolicy orgId={orgId} />,
      fakeApi(routes({ auditPolicy: "forbidden" }, "owner"))
    );
    expect(await screen.findByText("Locked by server config")).toBeTruthy();
  });
});

describe("MembersAdmin", () => {
  const members = [
    {
      joinedAt: fixtureTime(1),
      orgId,
      role: "owner",
      teamIds: [],
      user: userAda,
    },
    {
      joinedAt: fixtureTime(2),
      orgId,
      role: "member",
      teamIds: [],
      user: userBo,
    },
  ];

  it("invites by email and explains refusing to remove the last owner", async () => {
    const api = fakeApi({
      "DELETE /orgs/:orgId/members/:userId": () =>
        apiError("CONFLICT", 409, { reason: "last_owner" }),
      "GET /orgs/:orgId/invitations": () => [],
      "GET /orgs/:orgId/members": () => ({ items: members, nextCursor: null }),
      "POST /orgs/:orgId/invitations": ({ body }) => ({
        createdAt: fixtureTime(3),
        email: (body as { email: string }).email,
        expiresAt: fixtureTime(59),
        id: fixtureId("invitation", 1),
        invitedBy: userAda.id,
        orgId,
        role: "member",
        status: "pending",
        teamIds: [],
        token: INVITE_TOKEN,
      }),
    });
    renderWithApi(<MembersAdmin orgId={orgId} />, api);
    expect(await screen.findByText(userBo.name)).toBeTruthy();

    await userEvent.fill(screen.getByLabelText("Email"), "cy@example.test");
    await userEvent.click(screen.getByRole("button", { name: "Invite" }));
    await waitFor(() =>
      expect(
        api.calls.find((call) => call.route.startsWith("POST"))?.body
      ).toEqual({ email: "cy@example.test", role: "member", teamIds: [] })
    );
    // The link carries the one-time token, shown once.
    const link = (await screen.findByLabelText(
      "Invite link"
    )) as HTMLInputElement;
    expect(link.value).toBe(`${window.location.origin}/invite/${INVITE_TOKEN}`);

    fireEvent.click(
      screen.getByRole("button", { name: `Remove ${userAda.name}` })
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Remove member" })
    );
    expect(await screen.findByText(LAST_OWNER)).toBeTruthy();
  });
});

describe("TeamsAdmin", () => {
  it("shows the tree and explains why a parent can't be deleted", async () => {
    const api = fakeApi({
      "DELETE /teams/:id": () =>
        apiError("CONFLICT", 409, { reason: "not_empty" }),
      "GET /orgs/:orgId/teams": () => [teamPlatform, teamEngineering],
    });
    renderWithApi(<TeamsAdmin orgId={orgId} />, api);
    const items = await screen.findAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual([
      expect.stringContaining("Engineering"),
      expect.stringContaining("Platform"),
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Delete Engineering" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete team" }));
    expect(await screen.findByText(HAS_SUBTEAMS)).toBeTruthy();
  });

  it("renames inline", async () => {
    const api = fakeApi({
      "GET /orgs/:orgId/teams": () => [teamEngineering],
      "PATCH /teams/:id": ({ body }) => ({
        ...teamEngineering,
        name: (body as { name: string }).name,
      }),
    });
    renderWithApi(<TeamsAdmin orgId={orgId} />, api);
    await userEvent.click(
      await screen.findByRole("button", { name: "Rename Engineering" })
    );
    const input = screen.getByRole("textbox", {
      name: "New name for Engineering",
    });
    await userEvent.fill(input, "R&D");
    await userEvent.keyboard("{Enter}");
    await waitFor(() =>
      expect(
        api.calls.find((call) => call.route.startsWith("PATCH"))?.body
      ).toEqual({
        name: "R&D",
      })
    );
  });
});

describe("UsageAdmin", () => {
  it("shows month-to-date spend and sets a budget in micros", async () => {
    const api = fakeApi({
      "GET /orgs/:orgId/budgets": () => [],
      "GET /orgs/:orgId/teams": () => [],
      "GET /usage/summary": () => ({
        from: fixtureTime(0),
        principal: { id: orgId, type: "org" },
        rows: [
          {
            costMicros: 12_500_000,
            key: "anthropic:claude-opus-5-5",
            usage: { inputTokens: 1000, outputTokens: 500 },
          },
        ],
        to: fixtureTime(1),
        totalCostMicros: 12_500_000,
      }),
      "PUT /budgets": ({ body }) => ({
        ...(body as object),
        id: fixtureId("budget", 1),
        resetsAt: fixtureTime(59),
        usedMicros: 0,
      }),
    });
    renderWithApi(<UsageAdmin orgId={orgId} />, api);
    expect((await screen.findAllByText("$12.50")).length).toBeGreaterThan(0);
    expect(screen.getByText("1,500")).toBeTruthy();

    await userEvent.fill(screen.getByLabelText("Limit (USD)"), "25.5");
    await userEvent.click(screen.getByRole("button", { name: "Set budget" }));
    await waitFor(() =>
      expect(
        api.calls.find((call) => call.route === "PUT /budgets")?.body
      ).toEqual({
        hard: true,
        limitMicros: 25_500_000,
        orgId,
        period: "month",
        principal: { id: orgId, type: "org" },
      })
    );
  });
});

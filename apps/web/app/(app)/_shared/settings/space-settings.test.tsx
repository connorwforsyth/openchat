import { cleanup, screen, waitFor } from "@testing-library/react";
import {
  fixtureId,
  fixtureTime,
  org,
  teamPlatform,
  userAda,
  userBo,
} from "@workspace/contract/fixtures";
import type { Space, SpaceMember } from "@workspace/contract/schemas/spaces";
import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import { AppFrameProvider } from "@/app/(app)/_shared/app-frame";
import { testFrame } from "@/app/(app)/_shared/frame-fixture";
import { fakeApi, renderWithApi } from "@/app/(app)/_shared/test-harness";
import { SpaceMembers } from "./space-settings";

vi.mock("next/navigation", () => ({
  usePathname: () => "/settings",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

afterEach(() => {
  cleanup();
});

const INVITE_TOKEN = "k7Qm2c9Xr1VbN0pLw4Ez8TjYs6HgFdAaUoIiPq3Ke5M";

const rootSpace = (canManage: boolean): Space => ({
  access: canManage ? "admin" : "member",
  canManage,
  id: org.id,
  isPersonal: false,
  memberCount: 2,
  myRole: canManage ? "admin" : "member",
  name: org.name,
  orgId: org.id,
  parent: null,
  type: "org",
});

const platform: Space = {
  access: "member",
  canManage: true,
  id: teamPlatform.id,
  isPersonal: false,
  memberCount: 1,
  myRole: "owner",
  name: teamPlatform.name,
  orgId: org.id,
  parent: { id: org.id, type: "org" },
  type: "team",
};

const member = (user: typeof userAda) => ({
  addedAt: fixtureTime(1),
  role: "member",
  user,
});

const renderPlatformMembers = ({
  managesRoot,
}: {
  readonly managesRoot: boolean;
}) => {
  const api = fakeApi({
    "GET /orgs/:orgId/teams": () => [teamPlatform],
    "GET /spaces": () => [rootSpace(managesRoot), platform],
    "GET /spaces/org/:id/members": () => [member(userAda), member(userBo)],
    "GET /spaces/team/:id/members": () => [member(userAda)],
    "POST /orgs/:orgId/invitations": ({ body }) => ({
      createdAt: fixtureTime(3),
      email: (body as { email: string }).email,
      expiresAt: fixtureTime(59),
      id: fixtureId("invitation", 1),
      invitedBy: userAda.id,
      orgId: org.id,
      role: "member",
      status: "pending",
      teamIds: (body as { teamIds: string[] }).teamIds,
      token: INVITE_TOKEN,
    }),
  });
  const frame = testFrame();
  renderWithApi(
    <AppFrameProvider
      value={{
        ...frame,
        chat: {
          ...frame.chat,
          draftContext: { id: teamPlatform.id, type: "team" },
        },
      }}
    >
      <SpaceMembers />
    </AppFrameProvider>,
    api
  );
  return api;
};

describe("SubSpaceMembers invitations", () => {
  it("invites straight into the sub-space when the caller manages the root", async () => {
    const api = renderPlatformMembers({ managesRoot: true });
    expect(
      await screen.findByRole("heading", { name: "Invite someone to Platform" })
    ).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: "Sub-space" })).toBeNull();

    await userEvent.fill(screen.getByLabelText("Email"), "cy@example.test");
    await userEvent.click(screen.getByRole("button", { name: "Invite" }));
    await waitFor(() =>
      expect(
        api.calls.find((call) => call.route.startsWith("POST /orgs/"))
      ).toEqual({
        body: {
          email: "cy@example.test",
          role: "member",
          teamIds: [teamPlatform.id],
        },
        route: `POST /orgs/${org.id}/invitations`,
      })
    );
    const link = (await screen.findByLabelText(
      "Invite link"
    )) as HTMLInputElement;
    expect(link.value).toBe(`${window.location.origin}/invite/${INVITE_TOKEN}`);
  });

  it("tells a sub-space owner who can't manage the root who can invite", async () => {
    renderPlatformMembers({ managesRoot: false });
    expect(
      await screen.findByText(
        `Only owners and admins of ${org.name} can invite new people. You can add someone already in ${org.name}.`
      )
    ).toBeTruthy();
    expect(screen.getByLabelText(`Add someone from ${org.name}`)).toBeTruthy();
    expect(screen.queryByLabelText("Email")).toBeNull();
  });
});

const ORG = "0190a000-0000-7000-8000-000000000001";
const TEAM = "0190a000-0000-7000-8000-000000000011";

const design = (canManage: boolean): Space =>
  ({
    access: "member",
    canManage,
    id: TEAM,
    isPersonal: false,
    memberCount: 1,
    myRole: canManage ? "owner" : "member",
    name: "Design",
    orgId: ORG,
    parent: { id: ORG, type: "org" },
    type: "team",
  }) as Space;

const ada: SpaceMember = {
  addedAt: "2026-10-01T00:00:00.000Z",
  role: "owner",
  user: {
    email: "ada@example.test",
    id: "0190a000-0000-7000-8000-0000000000a1",
    name: "Ada",
  },
} as SpaceMember;

const renderMembers = (space: Space) =>
  renderWithApi(
    <AppFrameProvider value={testFrame()}>
      <SpaceMembers />
    </AppFrameProvider>,
    fakeApi({
      "GET /spaces": () => [space],
      "GET /spaces/:type/:id/members": () => [ada],
    })
  );

const READ_ONLY = /only its owners and admins/i;

describe("SpaceMembers", () => {
  it("tells a member why the list is read-only", async () => {
    renderMembers(design(false));
    expect(await screen.findByText("Ada")).toBeTruthy();
    expect(screen.getByText(READ_ONLY)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add" })).toBeNull();
  });

  it("says nothing of the kind to someone who manages the space", async () => {
    renderMembers(design(true));
    expect(await screen.findByRole("button", { name: "Add" })).toBeTruthy();
    expect(screen.queryByText(READ_ONLY)).toBeNull();
  });
});

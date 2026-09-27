import { cleanup, screen } from "@testing-library/react";
import { fixtureId, me as meFixture } from "@workspace/contract/fixtures";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fakeApi, renderWithApi } from "../../_shared/test-harness";
import {
  contextKey,
  contextOptions,
  ProfileSettings,
} from "./profile-settings";

vi.mock("next/navigation", () => ({
  usePathname: () => "/settings/profile",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

afterEach(() => {
  cleanup();
});

const settings = {
  defaultContext: { type: "personal" },
  defaultTarget: null,
  locale: null,
};

describe("ProfileSettings", () => {
  it("shows who is signed in and their preferences", async () => {
    const api = fakeApi({
      "GET /config": () => {
        throw new Error("offline");
      },
      "GET /me": () => meFixture,
      "GET /me/settings": () => settings,
    });
    renderWithApi(<ProfileSettings />, api);
    expect(await screen.findByText(meFixture.user.email)).toBeTruthy();
    expect(await screen.findByText("Match my browser")).toBeTruthy();
  });

  it("says so when it can't load", async () => {
    const api = fakeApi({ "GET /me/settings": () => settings });
    renderWithApi(<ProfileSettings />, api);
    expect(
      (await screen.findAllByText("This couldn't be loaded.")).length
    ).toBeGreaterThan(0);
  });
});

describe("contextOptions", () => {
  it("offers only the contexts the instance allows", () => {
    const labels = { personal: "Personal" };
    const all = contextOptions(meFixture, ["personal", "team", "org"], labels);
    const personalOnly = contextOptions(meFixture, ["personal"], labels);
    expect(personalOnly.map((option) => option.value)).toEqual(["personal"]);
    expect(all.length).toBeGreaterThanOrEqual(personalOnly.length);
    expect(all.map((option) => option.label)).toContain("Platform");
    expect(contextKey({ id: fixtureId("team", 1), type: "team" })).toBe(
      `team:${fixtureId("team", 1)}`
    );
  });
});

import { setupI18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import { AcceptInvite } from "./accept-invite";
import { SignInForm } from "./sign-in-form";
import { SignUpForm } from "./sign-up-form";

// The forms against a fake `/api/auth`: what they send and how they explain
// a refusal. Success leaves the page (a full load), so it's Playwright's (040).

const UNAVAILABLE = /Sign-in isn't available on this server/;
const INVITE_ONLY = /This server is invite-only/;
const ORIGIN_REJECTED = /This address isn't allowed to sign in/;
const UNREACHABLE = /Couldn't reach the server/;
const TRUSTED_ORIGINS_HINT = /ask them to add this one/;
const MICROSOFT = /Microsoft/;

const i18n = setupI18n({ locale: "en", messages: { en: {} } });
const renderWithI18n = (ui: ReactNode) =>
  render(<I18nProvider i18n={i18n}>{ui}</I18nProvider>);

const answer = (status: number, body: object) =>
  vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
    Response.json(body, { status })
  );

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const requestOf = async (fetcher: ReturnType<typeof answer>) => {
  const [input, init] = fetcher.mock.calls[0] ?? [];
  const request = new Request(input ?? "", init);
  return { body: await request.json(), url: new URL(request.url).pathname };
};

describe("SignInForm", () => {
  it("signs in with email and password, and says when they don't match", async () => {
    const fetcher = answer(401, {
      code: "INVALID_EMAIL_OR_PASSWORD",
      message: "Invalid email or password",
    });
    vi.stubGlobal("fetch", fetcher);
    renderWithI18n(<SignInForm next="/" />);
    await userEvent.type(screen.getByLabelText("Email"), "ada@example.test");
    await userEvent.type(screen.getByLabelText("Password"), "not-it-1");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(
      await screen.findByText("That email and password don't match an account.")
    ).toBeTruthy();
    expect(await requestOf(fetcher)).toEqual({
      body: expect.objectContaining({
        email: "ada@example.test",
        password: "not-it-1",
      }),
      url: "/api/auth/sign-in/email",
    });
  });

  it("names the configured address when this one isn't trusted (054)", async () => {
    vi.stubGlobal(
      "fetch",
      answer(403, { code: "INVALID_ORIGIN", message: "Invalid origin" })
    );
    renderWithI18n(
      <SignInForm appUrl="https://chat.example.test" next="/library" />
    );
    await userEvent.type(screen.getByLabelText("Email"), "ada@example.test");
    await userEvent.type(screen.getByLabelText("Password"), "whatever-1");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText(ORIGIN_REJECTED)).toBeTruthy();
    const link = screen.getByRole("link", {
      name: "https://chat.example.test",
    });
    // The same page, on the address that works.
    expect(link.getAttribute("href")).toBe(
      new URL(
        `${window.location.pathname}${window.location.search}`,
        "https://chat.example.test"
      ).href
    );
  });

  it("says when the server can't be reached", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("Failed to fetch")))
    );
    renderWithI18n(<SignInForm next="/" />);
    await userEvent.type(screen.getByLabelText("Email"), "ada@example.test");
    await userEvent.type(screen.getByLabelText("Password"), "whatever-1");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText(UNREACHABLE)).toBeTruthy();
  });

  it("says sign-in isn't set up when nothing answers", async () => {
    vi.stubGlobal("fetch", answer(503, { code: "SERVICE_UNAVAILABLE" }));
    renderWithI18n(<SignInForm next="/" />);
    await userEvent.type(screen.getByLabelText("Email"), "ada@example.test");
    await userEvent.type(screen.getByLabelText("Password"), "whatever-1");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText(UNAVAILABLE)).toBeTruthy();
  });
});

describe("SignUpForm", () => {
  it("explains an invite-only refusal (D22)", async () => {
    const fetcher = answer(403, {
      code: "invite_required",
      message: "This server is invite-only.",
    });
    vi.stubGlobal("fetch", fetcher);
    renderWithI18n(<SignUpForm next="/" />);
    await userEvent.type(screen.getByLabelText("Name"), "Bo");
    await userEvent.type(screen.getByLabelText("Email"), "bo@example.test");
    await userEvent.type(screen.getByLabelText("Password"), "long-enough-1");
    await userEvent.click(
      screen.getByRole("button", { name: "Create account" })
    );
    expect(await screen.findByText(INVITE_ONLY)).toBeTruthy();
    expect(await requestOf(fetcher)).toEqual({
      body: expect.objectContaining({
        email: "bo@example.test",
        name: "Bo",
        password: "long-enough-1",
      }),
      url: "/api/auth/sign-up/email",
    });
  });
});

describe("SignUpForm, origin refused (054)", () => {
  it("asks for an administrator when no address is configured", async () => {
    vi.stubGlobal("fetch", answer(403, { code: "INVALID_ORIGIN" }));
    renderWithI18n(<SignUpForm next="/" />);
    await userEvent.type(screen.getByLabelText("Name"), "Bo");
    await userEvent.type(screen.getByLabelText("Email"), "bo@example.test");
    await userEvent.type(screen.getByLabelText("Password"), "long-enough-1");
    await userEvent.click(
      screen.getByRole("button", { name: "Create account" })
    );
    expect(await screen.findByText(TRUSTED_ORIGINS_HINT)).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });
});

describe("AcceptInvite", () => {
  it("accepts with the link's token and says when it's used up", async () => {
    const fetcher = answer(404, {
      code: "NOT_FOUND",
      defined: true,
      message: "Not found.",
      status: 404,
    });
    vi.stubGlobal("fetch", fetcher);
    const token = "k7Qm2c9Xr1VbN0pLw4Ez8TjYs6HgFdAaUoIiPq3Ke5M";
    renderWithI18n(<AcceptInvite input={{ token }} />);
    await userEvent.click(
      screen.getByRole("button", { name: "Accept invitation" })
    );
    expect(
      await screen.findByText(
        "This invitation has expired, was cancelled or was already used."
      )
    ).toBeTruthy();
    expect(await requestOf(fetcher)).toEqual({
      body: { token },
      url: "/api/invitations/accept",
    });
  });
});

describe("SocialButtons, Microsoft (186)", () => {
  it("shows a Microsoft button only when it's configured, and starts sign-in", async () => {
    const { SocialButtons } = await import("./social-buttons");
    const { unmount } = renderWithI18n(
      <SocialButtons callbackUrl="/" providers={[]} />
    );
    expect(screen.queryByRole("button", { name: MICROSOFT })).toBeNull();
    unmount();

    const fetcher = answer(200, {
      redirect: false,
      url: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    });
    vi.stubGlobal("fetch", fetcher);
    renderWithI18n(
      <SocialButtons
        callbackUrl="/chats"
        providers={[{ id: "microsoft", name: "Microsoft" }]}
      />
    );
    const button = screen.getByRole("button", {
      name: "Continue with Microsoft",
    });
    expect(button.querySelector('svg[data-brand="microsoft"]')).toBeTruthy();
    await userEvent.click(button);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalled());
    expect(await requestOf(fetcher)).toEqual({
      body: { callbackURL: "/chats", provider: "microsoft" },
      url: "/api/auth/sign-in/social",
    });
  });
});

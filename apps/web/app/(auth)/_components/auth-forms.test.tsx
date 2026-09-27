import { setupI18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import { SignInForm } from "./sign-in-form";
import { SignUpForm } from "./sign-up-form";

// The forms against a fake `/api/auth`: what they send and how they explain
// a refusal. Success leaves the page (a full load), so it's Playwright's (040).

const UNAVAILABLE = /Sign-in isn't available on this server/;
const INVITE_ONLY = /This server is invite-only/;

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

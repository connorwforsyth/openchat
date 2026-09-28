import { describe, expect, it } from "vitest";

import { authProblemOf } from "./auth-errors";

describe("authProblemOf", () => {
  it("maps Better Auth's codes, whatever their case", () => {
    expect(
      authProblemOf({ code: "INVALID_EMAIL_OR_PASSWORD", status: 401 })
    ).toBe("wrong_credentials");
    expect(authProblemOf({ code: "USER_ALREADY_EXISTS", status: 422 })).toBe(
      "email_taken"
    );
    expect(authProblemOf({ code: "PASSWORD_TOO_SHORT", status: 400 })).toBe(
      "weak_password"
    );
  });

  it("maps the sign-up policy's refusals (D22)", () => {
    expect(authProblemOf({ code: "invite_required", status: 403 })).toBe(
      "invite_required"
    );
    expect(authProblemOf({ code: "DOMAIN_NOT_ALLOWED", status: 403 })).toBe(
      "domain_not_allowed"
    );
    expect(authProblemOf({ code: "sso_required" })).toBe("sso_required");
  });

  it("says sign-in is unavailable when nothing answers at /api/auth", () => {
    expect(authProblemOf({ status: 503 })).toBe("unavailable");
    expect(authProblemOf({ status: 404 })).toBe("unavailable");
  });

  it("says when the page's address isn't a trusted origin (054)", () => {
    expect(authProblemOf({ code: "INVALID_ORIGIN", status: 403 })).toBe(
      "origin_rejected"
    );
    expect(authProblemOf({ code: "MISSING_OR_NULL_ORIGIN", status: 403 })).toBe(
      "origin_rejected"
    );
  });

  it("names the other failures a person can act on", () => {
    expect(authProblemOf({ code: "INVALID_EMAIL", status: 400 })).toBe(
      "invalid_email"
    );
    expect(authProblemOf({ code: "PASSWORD_TOO_LONG", status: 400 })).toBe(
      "password_too_long"
    );
    expect(authProblemOf({ status: 429 })).toBe("rate_limited");
    expect(authProblemOf({ code: "SOMETHING_NEW", status: 500 })).toBe(
      "server_error"
    );
    expect(authProblemOf(new TypeError("Failed to fetch"))).toBe("unreachable");
  });

  it("falls back to a generic failure", () => {
    expect(authProblemOf({ code: "SOMETHING_NEW", status: 400 })).toBe(
      "failed"
    );
    expect(authProblemOf(new Error("boom"))).toBe("failed");
    expect(authProblemOf(null)).toBe("failed");
  });
});

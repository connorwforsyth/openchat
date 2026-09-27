import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { fixtureId, fixtureTime } from "@workspace/contract/fixtures";
import type { ProviderKey } from "@workspace/contract/schemas/keys";
import { afterEach, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";

import { KeysManager } from "./keys-manager";
import { apiError, fakeApi, renderWithApi } from "./test-harness";

const REMOVE = /^Remove/;
const CHECK_PROVIDER = /Check the provider/;
const NEEDS_ENCRYPTION_KEY = /an admin needs to set its encryption key/;

afterEach(() => {
  cleanup();
});

const owner = { id: fixtureId("user", 1), type: "user" as const };

const key = (n: number, extra: Partial<ProviderKey> = {}): ProviderKey => ({
  baseURL: null,
  createdAt: fixtureTime(n),
  createdBy: owner.id,
  hint: "a1b2",
  id: fixtureId("providerKey", n),
  label: "Work",
  lastUsedAt: null,
  provider: "anthropic",
  scope: owner,
  source: "database",
  ...extra,
});

describe("KeysManager", () => {
  it("lists keys by hint only, with config keys read-only", async () => {
    const seen: string[] = [];
    const api = fakeApi({
      "GET /keys": ({ search }) => {
        seen.push(search.toString());
        return [
          key(1),
          key(2, {
            createdBy: null,
            hint: "z9y8",
            label: "",
            provider: "openai",
            scope: { type: "instance" },
            source: "config",
          }),
        ];
      },
    });
    renderWithApi(<KeysManager owner={owner} />, api);
    expect(await screen.findByText("…a1b2", { exact: false })).toBeTruthy();
    expect(screen.getByText("Server config")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: REMOVE })).toHaveLength(1);
    expect(seen[0]).toBe(`scopeId=${owner.id}&scopeType=user`);
  });

  it("sends a new key once and clears the field", async () => {
    let keys: ProviderKey[] = [];
    const api = fakeApi({
      "GET /keys": () => keys,
      "POST /keys": () => {
        keys = [key(3)];
        return key(3);
      },
    });
    renderWithApi(<KeysManager owner={owner} />, api);
    await screen.findByText("No keys yet");
    await userEvent.fill(screen.getByLabelText("Provider"), "anthropic");
    await userEvent.fill(screen.getByLabelText("Label"), "Work");
    await userEvent.fill(screen.getByLabelText("API key"), "sk-test-00000000");
    await userEvent.click(screen.getByRole("button", { name: "Add key" }));

    await waitFor(() =>
      expect(
        api.calls.find((call) => call.route === "POST /keys")?.body
      ).toEqual({
        apiKey: "sk-test-00000000",
        label: "Work",
        provider: "anthropic",
        scope: owner,
      })
    );
    await screen.findByText("…a1b2", { exact: false });
    expect((screen.getByLabelText("API key") as HTMLInputElement).value).toBe(
      ""
    );
  });

  it("says when the server can't store keys, instead of asking to retry", async () => {
    const api = fakeApi({
      "GET /keys": () => [],
      "POST /keys": () => apiError("ENCRYPTION_UNAVAILABLE", 503),
    });
    renderWithApi(<KeysManager owner={owner} />, api);
    await screen.findByText("No keys yet");
    await userEvent.fill(screen.getByLabelText("Provider"), "anthropic");
    await userEvent.fill(screen.getByLabelText("API key"), "sk-test-00000000");
    await userEvent.click(screen.getByRole("button", { name: "Add key" }));
    expect(await screen.findByText(NEEDS_ENCRYPTION_KEY)).toBeTruthy();
    expect(screen.queryByText("The key couldn't be added. Try again.")).toBe(
      null
    );
  });

  it("refuses a bad provider id before calling the server", async () => {
    const api = fakeApi({ "GET /keys": () => [] });
    renderWithApi(<KeysManager owner={owner} />, api);
    await screen.findByText("No keys yet");
    await userEvent.fill(screen.getByLabelText("Provider"), "Not A Provider");
    await userEvent.fill(screen.getByLabelText("API key"), "sk-test-00000000");
    await userEvent.click(screen.getByRole("button", { name: "Add key" }));
    expect(await screen.findByText(CHECK_PROVIDER)).toBeTruthy();
    expect(api.calls.some((call) => call.route === "POST /keys")).toBe(false);
  });

  it("removes a key after confirming", async () => {
    let keys = [key(1)];
    const api = fakeApi({
      "DELETE /keys/:id": ({ params }) => {
        keys = keys.filter((each) => each.id !== params.id);
      },
      "GET /keys": () => keys,
    });
    renderWithApi(<KeysManager owner={owner} />, api);
    fireEvent.click(await screen.findByRole("button", { name: "Remove Work" }));
    fireEvent.click(await screen.findByRole("button", { name: "Remove key" }));
    expect(await screen.findByText("No keys yet")).toBeTruthy();
    expect(api.calls.map((call) => call.route)).toContain(
      `DELETE /keys/${fixtureId("providerKey", 1)}`
    );
  });
});

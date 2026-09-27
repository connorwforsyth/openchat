import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { fixtureTime, org } from "@workspace/contract/fixtures";
import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import { NewOrgDialog } from "./new-org-dialog";
import { apiError, fakeApi, renderWithApi } from "./test-harness";

afterEach(() => {
  cleanup();
});

const created = (body: unknown) => ({
  ...org,
  ...(body as { name: string; slug: string }),
  createdAt: fixtureTime(5),
});

describe("NewOrgDialog", () => {
  it("suggests the short name from the name and creates the org", async () => {
    const onCreated = vi.fn();
    const api = fakeApi({
      "POST /orgs": ({ body }) => created(body),
    });
    renderWithApi(
      <NewOrgDialog onCreated={onCreated} onOpenChange={vi.fn()} open />,
      api
    );
    await userEvent.fill(
      screen.getByLabelText("Organisation name"),
      "Beta Labs, Inc."
    );
    expect(
      (screen.getByLabelText("Short name") as HTMLInputElement).value
    ).toBe("beta-labs-inc");
    // The dialog's enter animation never settles for Playwright's
    // stability check here (as with the confirm dialogs' buttons).
    fireEvent.click(
      screen.getByRole("button", { name: "Create organisation" })
    );
    await waitFor(() =>
      expect(onCreated).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Beta Labs, Inc.",
          slug: "beta-labs-inc",
        })
      )
    );
    expect(api.calls.find((call) => call.route === "POST /orgs")?.body).toEqual(
      { name: "Beta Labs, Inc.", slug: "beta-labs-inc" }
    );
  });

  it("says when the short name is taken", async () => {
    const onCreated = vi.fn();
    renderWithApi(
      <NewOrgDialog onCreated={onCreated} onOpenChange={vi.fn()} open />,
      fakeApi({ "POST /orgs": () => apiError("CONFLICT", 409) })
    );
    await userEvent.fill(screen.getByLabelText("Organisation name"), "Acme");
    await userEvent.fill(screen.getByLabelText("Short name"), "acme-two");
    // The dialog's enter animation never settles for Playwright's
    // stability check here (as with the confirm dialogs' buttons).
    fireEvent.click(
      screen.getByRole("button", { name: "Create organisation" })
    );
    expect(
      await screen.findByText("That short name is taken. Try another.")
    ).toBeTruthy();
    expect(onCreated).not.toHaveBeenCalled();
  });
});

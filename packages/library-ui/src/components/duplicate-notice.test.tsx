import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { agentItem } from "@workspace/contract/fixtures";
import type { LibraryItemDetail } from "@workspace/contract/schemas/library";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";

import {
  createFakeLibraryClient,
  type FakeLibraryClient,
} from "../testing/fake-client";
import { createTestProviders } from "../testing/providers";
import { ItemBuilder } from "./item-builder";

afterEach(() => {
  cleanup();
});

const NOT_COPIED = /wasn't copied|weren't copied/;

/** Opens the copy's builder once duplicated, as the app's page does. */
function Page() {
  const [copy, setCopy] = useState<LibraryItemDetail | null>(null);
  return (
    <>
      {copy ? <p>Opened the copy</p> : null}
      <ItemBuilder
        backHref="/library"
        key={copy?.id ?? agentItem.id}
        onDuplicated={setCopy}
        target={{ id: copy?.id ?? agentItem.id, type: "existing" }}
      />
    </>
  );
}

describe("duplicate notice", () => {
  it("says which knowledge files a copy left out, until dismissed", async () => {
    const fake = createFakeLibraryClient();
    // The server drops knowledge files the copier can't read on their own.
    const client: FakeLibraryClient = {
      ...fake,
      library: {
        ...fake.library,
        duplicate: async (input) => {
          const copy = await fake.library.duplicate(input);
          return copy.definition?.kind === "agent"
            ? {
                ...copy,
                definition: { ...copy.definition, knowledgeFileIds: [] },
              }
            : copy;
        },
      },
    };
    const providers = createTestProviders(client);
    render(providers.wrap(<Page />));

    await userEvent.click(
      await screen.findByRole("button", { name: "More actions" })
    );
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "Duplicate to my library" })
    );
    expect(
      await screen.findByText("1 knowledge file wasn't copied")
    ).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    await waitFor(() =>
      expect(screen.queryByText("1 knowledge file wasn't copied")).toBeNull()
    );
  });

  it("says nothing when every file came along", async () => {
    const providers = createTestProviders();
    render(providers.wrap(<Page />));
    await userEvent.click(
      await screen.findByRole("button", { name: "More actions" })
    );
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "Duplicate to my library" })
    );
    expect(await screen.findByText("Opened the copy")).toBeTruthy();
    await screen.findByRole("button", { name: "More actions" });
    expect(screen.queryByText(NOT_COPIED)).toBeNull();
  });
});

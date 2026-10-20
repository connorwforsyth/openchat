import {
  cleanup,
  configure,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { fixtureId } from "@workspace/contract/fixtures";
import type { LibraryItemDetail } from "@workspace/contract/schemas/library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import { libraryKeys } from "../cache";
import { EchoTestChat } from "../testing/echo-test-chat";
import { createFakeLibraryClient } from "../testing/fake-client";
import { createTestProviders } from "../testing/providers";
import { type BuilderTarget, ItemBuilder } from "./item-builder";

// The fake server answers after 1.5 s so optimistic states are observable on
// slow CI runners; async queries must outlast it.
configure({ asyncUtilTimeout: 5000 });

afterEach(() => {
  cleanup();
});

const PROMPT = fixtureId("libraryItem", 20);
const SKILL = fixtureId("libraryItem", 30);
const PLATFORM = /Platform/;
const EXAMPLE_CO = /Example Co/;

const renderBuilder = (
  target: BuilderTarget,
  client = createFakeLibraryClient(),
  onCreated = vi.fn()
) => {
  const providers = createTestProviders(client);
  render(
    providers.wrap(
      <ItemBuilder backHref="/library" onCreated={onCreated} target={target} />
    )
  );
  return { ...providers, onCreated };
};

describe("builder form validation", () => {
  it("won't create until the contract's rules pass, then creates", async () => {
    const { onCreated } = renderBuilder({ kind: "prompt", type: "new" });
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    // The template is required by the contract; the name too.
    expect((await screen.findAllByText("Required.")).length).toBeGreaterThan(0);
    expect(
      screen.getByRole("textbox", { name: "Name" }).getAttribute("aria-invalid")
    ).toBe("true");
    expect(onCreated).not.toHaveBeenCalled();

    await userEvent.fill(screen.getByRole("textbox", { name: "Name" }), "Hi");
    await userEvent.fill(
      screen.getByRole("textbox", { name: "Template" }),
      "Say hi to {{who}}."
    );
    // The placeholder becomes a variable to describe.
    expect(
      await screen.findByRole("textbox", { name: "Description for who" })
    ).toBeTruthy();
    await userEvent.fill(
      screen.getByRole("textbox", { name: "Slash command" }),
      "Not Valid"
    );
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(await screen.findByText("That doesn't look right.")).toBeTruthy();

    await userEvent.fill(
      screen.getByRole("textbox", { name: "Slash command" }),
      "hi"
    );
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledOnce());
    expect(onCreated.mock.calls[0]?.[0]).toMatchObject({
      definition: { command: "hi", template: "Say hi to {{who}}." },
      name: "Hi",
    });
  });
});

describe("agent builder", () => {
  it("tests the draft on screen, before it's saved", async () => {
    const providers = createTestProviders();
    render(
      providers.wrap(
        <ItemBuilder
          backHref="/library"
          target={{ kind: "agent", type: "new" }}
          testChat={EchoTestChat}
        />
      )
    );
    expect(
      await screen.findByText("Try the draft before you publish it.")
    ).toBeTruthy();
    await userEvent.fill(
      screen.getByRole("textbox", { name: "Instructions" }),
      "Answer like a pirate."
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Add a starter" })
    );
    await userEvent.fill(
      screen.getByRole("textbox", { name: "Starter 1" }),
      "Ahoy?"
    );
    const chat = screen.getByRole("region", { name: "Test chat" });
    await userEvent.click(within(chat).getByRole("button", { name: "Ahoy?" }));
    expect(
      await within(chat).findByText("Answer like a pirate.", { exact: false })
    ).toBeTruthy();
  });
});

describe("agent builder sections (192)", () => {
  it("names the editor after the agent and turns capabilities on with switches", async () => {
    renderBuilder({ kind: "agent", type: "new" });
    expect(await screen.findByText("New Agent")).toBeTruthy();
    expect(screen.getByText("Not created yet")).toBeTruthy();
    await userEvent.fill(
      screen.getByRole("textbox", { name: "Name" }),
      "Pirate"
    );
    expect(
      screen.getByRole("heading", { level: 1, name: "Pirate" })
    ).toBeTruthy();
    const web = screen.getByRole("switch", { name: "Search the web" });
    expect(web.getAttribute("aria-checked")).toBe("false");
    await userEvent.click(screen.getByText("Search the web"));
    await waitFor(() => expect(web.getAttribute("aria-checked")).toBe("true"));
    for (const title of [
      "Instructions",
      "Conversation starters",
      "Knowledge",
      "Capabilities",
      "Connections",
      "Model and runtime",
    ]) {
      expect(
        screen.getByRole("heading", { level: 2, name: title })
      ).toBeTruthy();
    }
  });
});

describe("skill builder (192)", () => {
  it("edits SKILL.md's frontmatter as fields and creates the composed file", async () => {
    const { onCreated } = renderBuilder({ kind: "skill", type: "new" });
    await userEvent.fill(
      await screen.findByRole("textbox", { name: "Name" }),
      "PDF Tools"
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Use pdf-tools" })
    );
    expect(
      (screen.getByRole("textbox", { name: "Skill name" }) as HTMLInputElement)
        .value
    ).toBe("pdf-tools");
    await userEvent.fill(
      screen.getByRole("textbox", { name: "When to use it" }),
      "Use when: a PDF is shared"
    );
    await userEvent.fill(
      screen.getByRole("textbox", { name: "Instructions" }),
      "Read it."
    );
    await userEvent.click(screen.getByRole("button", { name: "SKILL.md" }));
    const raw = screen.getByRole("textbox", { name: "SKILL.md" });
    expect((raw as HTMLTextAreaElement).value).toBe(
      '---\nname: pdf-tools\ndescription: "Use when: a PDF is shared"\n---\n\nRead it.'
    );
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(onCreated.mock.calls[0]?.[0]).toMatchObject({
      definition: { kind: "skill" },
      name: "PDF Tools",
    });
  });

  it("flags a skill name that breaks the Agent Skills format", async () => {
    renderBuilder({ kind: "skill", type: "new" });
    await userEvent.fill(
      await screen.findByRole("textbox", { name: "Skill name" }),
      "PDF Tools"
    );
    expect(await screen.findByText("That doesn't look right.")).toBeTruthy();
  });
});

describe("optimistic saves", () => {
  it("shows the edit at once and rolls it back when the server refuses", async () => {
    const client = createFakeLibraryClient();
    // Wide enough that the optimistic state is observable on a slow CI runner.
    client.setLatency(1500);
    const { queryClient } = renderBuilder(
      { id: PROMPT, type: "existing" },
      client
    );
    const name = await screen.findByRole("textbox", { name: "Name" });
    await userEvent.fill(name, "Renamed");
    client.failNext("library.update");
    await userEvent.click(screen.getByRole("button", { name: "Save draft" }));

    const cached = () =>
      queryClient.getQueryData<LibraryItemDetail>(
        libraryKeys.detail(PROMPT, "draft")
      )?.name;
    // Optimistic: the cache has the new name before the server answers.
    expect(cached()).toBe("Renamed");
    expect(await screen.findByText("Saving…")).toBeTruthy();
    // Refused: the cache is back to what it was, and the page says so.
    await waitFor(() => expect(cached()).toBe("Explain a concept"));
    expect(
      await screen.findByText(
        "Your changes weren't saved, so they were undone."
      )
    ).toBeTruthy();
  });

  it("saves for real when the server accepts", async () => {
    const client = createFakeLibraryClient();
    renderBuilder({ id: PROMPT, type: "existing" }, client);
    await userEvent.fill(
      await screen.findByRole("textbox", { name: "Name" }),
      "Explain simply"
    );
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() =>
      expect(screen.queryByText("Unsaved changes")).toBeNull()
    );
    expect(
      (await client.library.get({ id: PROMPT, revision: "draft" })).name
    ).toBe("Explain simply");
  });
});

describe("publish dialog", () => {
  it("publishes the draft as v1 and shows it at once", async () => {
    const client = createFakeLibraryClient();
    // Wide enough that the optimistic state is observable on a slow CI runner.
    client.setLatency(1500);
    renderBuilder({ id: SKILL, type: "existing" }, client);
    expect(await screen.findByText("Draft")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Publish" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.fill(
      within(dialog).getByRole("textbox", { name: "What changed" }),
      "First cut"
    );
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Publish v1" })
    );
    expect(await screen.findByText("Published v1")).toBeTruthy();
    const versions = await client.library.listVersions({
      id: SKILL,
      limit: 10,
    });
    expect(versions.items[0]).toMatchObject({ notes: "First cut", number: 1 });
  });

  it("says when nothing changed since the last version", async () => {
    renderBuilder({ id: PROMPT, type: "existing" });
    await userEvent.click(
      await screen.findByRole("button", { name: "Publish" })
    );
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Publish v2" })
    );
    expect(
      await within(dialog).findByText(
        "Nothing has changed since the last version."
      )
    ).toBeTruthy();
  });
});

describe("share dialog", () => {
  const openShare = async () => {
    await userEvent.click(await screen.findByRole("button", { name: "Share" }));
    return await screen.findByRole("dialog");
  };

  it("lists who has access and shares with a team at the chosen level", async () => {
    renderBuilder({ id: PROMPT, type: "existing" });
    const dialog = await openShare();
    expect(await within(dialog).findByText("Bo")).toBeTruthy();
    await userEvent.click(
      within(
        within(dialog).getByRole("group", { name: "Level for new shares" })
      ).getByRole("button", { name: "View" })
    );
    await userEvent.fill(
      within(dialog).getByRole("textbox", {
        name: "Find people, teams or orgs",
      }),
      "plat"
    );
    await userEvent.click(
      await within(dialog).findByRole("button", { name: PLATFORM })
    );
    const people = within(dialog).getByRole("region", {
      name: "People with access",
    });
    await waitFor(() =>
      expect(within(people).getByText("Platform")).toBeTruthy()
    );
    expect(
      within(people)
        .getByRole("group", { name: "Level for Platform" })
        .querySelector("[aria-pressed=true]")?.textContent
    ).toBe("View");
  });

  it("takes a share back out when the server refuses it", async () => {
    const client = createFakeLibraryClient();
    // Wide enough that the optimistic state is observable on a slow CI runner.
    client.setLatency(1500);
    client.failNext("grants.create", "VALIDATION");
    renderBuilder({ id: PROMPT, type: "existing" }, client);
    const dialog = await openShare();
    await userEvent.fill(
      within(dialog).getByRole("textbox", {
        name: "Find people, teams or orgs",
      }),
      "example"
    );
    await userEvent.click(
      await within(dialog).findByRole("button", { name: EXAMPLE_CO })
    );
    const people = within(dialog).getByRole("region", {
      name: "People with access",
    });
    expect(await within(people).findByText("Example Co")).toBeTruthy();
    await waitFor(() =>
      expect(within(people).queryByText("Example Co")).toBeNull()
    );
    expect(
      await within(dialog).findByText(
        "That change didn't go through, so it was undone."
      )
    ).toBeTruthy();
  });
});

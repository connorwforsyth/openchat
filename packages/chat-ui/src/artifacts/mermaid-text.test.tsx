import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, screen } from "@testing-library/react";
import { createApiClient, createQueryUtils } from "@workspace/client/api";
import { fixtureId } from "@workspace/contract/fixtures";
import type { ArtifactVersion } from "@workspace/contract/schemas/files";
import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import { ArtifactCard } from "../conversation/artifact-card";
import { artifactPage, artifactVersions } from "../fixtures";
import { renderWithI18n } from "../testing/render";
import { MermaidText } from "./mermaid-text";

afterEach(cleanup);

const SAVED = /\/artifacts\/[^/]+\/versions$/;
const NOT_SAVED = /wasn't saved/;

const [first] = artifactVersions[artifactPage.id] ?? [];
const version = {
  ...(first as ArtifactVersion),
  content: "sequenceDiagram\n  A->>B: hi",
};

const setup = (status: number) => {
  const posted: unknown[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    if (SAVED.test(new URL(request.url).pathname)) {
      posted.push(await request.json());
      return status === 201
        ? Response.json(
            {
              ...version,
              content: "next",
              id: fixtureId("artifactVersion", 99),
              number: 2,
            },
            { status }
          )
        : Response.json(
            {
              code: "VALIDATION",
              message: "content isn't a valid mermaid artifact",
            },
            { status }
          );
    }
    return Response.json({});
  };
  const api = createQueryUtils(
    createApiClient({ baseUrl: "http://api.test", fetch })
  );
  const onSaved = vi.fn();
  renderWithI18n(
    <QueryClientProvider client={new QueryClient()}>
      <MermaidText
        api={api}
        artifactId={artifactPage.id}
        onSaved={onSaved}
        version={version}
      />
    </QueryClientProvider>
  );
  return { onSaved, posted };
};

describe("a Mermaid diagram, edited as text", () => {
  it("saves the text as the next version, on top of the one shown", async () => {
    const { onSaved, posted } = setup(201);
    const save = screen.getByRole("button", { name: "Save" });
    expect(save.hasAttribute("disabled")).toBe(true);
    const source = screen.getByRole("textbox", { name: "Diagram source" });
    await userEvent.fill(source, `${version.content}\n  B->>A: back`);
    await userEvent.click(save);
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(posted).toEqual([
      expect.objectContaining({
        baseVersionId: version.id,
        content: "sequenceDiagram\n  A->>B: hi\n  B->>A: back",
      }),
    ]);
  });

  it("says why when the edit isn't saved", async () => {
    const { onSaved } = setup(422);
    await userEvent.fill(
      screen.getByRole("textbox", { name: "Diagram source" }),
      "not a diagram"
    );
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(NOT_SAVED)).toBeTruthy();
    expect(onSaved).not.toHaveBeenCalled();
  });
});

describe("an artifact's card in the chat", () => {
  it("names and draws each kind as people see it", () => {
    for (const [kind, label] of [
      ["mermaid", "Diagram"],
      ["svg", "SVG image"],
      ["spreadsheet", "Spreadsheet"],
      ["presentation", "Presentation"],
    ] as const) {
      renderWithI18n(
        <ArtifactCard
          part={{
            artifactId: artifactPage.id,
            kind,
            title: "Thing",
            type: "artifact-ref",
            versionId: fixtureId("artifactVersion", 1),
          }}
        />
      );
      expect(screen.getByText(label)).toBeTruthy();
      cleanup();
    }
  });
});

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import {
  createApiClient,
  createQueryUtils,
  type QueryUtils,
} from "@workspace/client/api";
import { fixtureId, fixtureTime, userAda } from "@workspace/contract/fixtures";
import type { Feedback } from "@workspace/contract/schemas/feedback";
import type { Message } from "@workspace/contract/schemas/messages";
import { afterEach, describe, expect, it } from "vitest";

import { initialLeafId, treeMessages } from "../fixtures";
import { localBranchPath } from "../model/branch";
import { useBranchFeedback } from "./use-branch-feedback";

const path = localBranchPath(treeMessages, initialLeafId);
if (!path) {
  throw new Error("fixture branch path");
}
const branch = path.messages;
const answers = branch.filter((message) => message.role === "assistant");
const [firstAnswer, lastAnswer] = [answers[0], answers.at(-1)];
if (!(firstAnswer && lastAnswer) || answers.length < 2) {
  throw new Error("the fixture branch needs at least two answers");
}

const FEEDBACK_PATH = /\/messages\/([^/]+)\/feedback$/;

const thumbsUp = (messageId: Message["id"]): Feedback => ({
  comment: null,
  createdAt: fixtureTime(1),
  id: fixtureId("feedback", 1),
  messageId,
  rating: "up",
  shareWithMaintainers: false,
  updatedAt: fixtureTime(1),
  userId: userAda.id,
});

/**
 * A fake server for `feedback.get`: the first answer has a thumbs up, the
 * rest nothing. Each response waits for `release()`, so a test can see which
 * requests went out before any came back.
 */
const fakeServer = () => {
  const asked: string[] = [];
  const waiting: (() => void)[] = [];
  const fetch = (input: RequestInfo | URL): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const messageId = FEEDBACK_PATH.exec(url.pathname)?.[1] ?? "";
    asked.push(messageId);
    const body = messageId === firstAnswer.id ? thumbsUp(firstAnswer.id) : null;
    return new Promise((resolve) => {
      waiting.push(() => resolve(Response.json(body)));
    });
  };
  const release = () => {
    for (const respond of waiting.splice(0)) {
      respond();
    }
  };
  return { asked, fetch, release };
};

function Thumbs({
  api,
  messages,
}: {
  readonly api: QueryUtils;
  readonly messages: readonly Message[];
}) {
  const { byMessage } = useBranchFeedback(api, messages);
  return (
    <ul>
      {Object.entries(byMessage).map(([messageId, feedback]) => (
        <li key={messageId}>{`${messageId}:${feedback.rating}`}</li>
      ))}
    </ul>
  );
}

const setup = () => {
  const server = fakeServer();
  const api = createQueryUtils(
    createApiClient({ baseUrl: "http://api.test", fetch: server.fetch })
  );
  const queryClient = new QueryClient();
  const view = (messages: readonly Message[]) => (
    <QueryClientProvider client={queryClient}>
      <Thumbs api={api} messages={messages} />
    </QueryClientProvider>
  );
  const branchQueries = () =>
    queryClient
      .getQueryCache()
      .findAll({ queryKey: api.feedback.key() })
      .filter((query) => query.queryKey.includes("branch"));
  return { api, branchQueries, server, view };
};

afterEach(() => {
  cleanup();
});

describe("useBranchFeedback", () => {
  it("looks up a branch's answers as one query, every lookup sent together", async () => {
    const { branchQueries, server, view } = setup();
    render(view(branch));

    // Every answer is asked about before any reply arrives: one burst per
    // branch view, which a batching link turns into a single request.
    await waitFor(() => expect(server.asked).toHaveLength(answers.length));
    expect(server.asked.toSorted()).toEqual(
      answers.map((answer) => answer.id).toSorted()
    );
    expect(branchQueries()).toHaveLength(1);

    server.release();
    expect(await screen.findByText(`${firstAnswer.id}:up`)).toBeTruthy();
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });

  it("asks only about new answers when the branch grows", async () => {
    const { branchQueries, server, view } = setup();
    const { rerender } = render(view(branch));
    await waitFor(() => expect(server.asked).toHaveLength(answers.length));
    server.release();
    await screen.findByText(`${firstAnswer.id}:up`);

    // A new turn: the branch gains an answer.
    const next: Message = { ...lastAnswer, id: fixtureId("message", 999) };
    rerender(view([...branch, next]));
    await waitFor(() => expect(server.asked).toHaveLength(answers.length + 1));
    expect(server.asked.at(-1)).toBe(next.id);
    // What was known stays on screen while the new answer is looked up.
    expect(screen.getByText(`${firstAnswer.id}:up`)).toBeTruthy();

    server.release();
    await waitFor(() => expect(branchQueries()).toHaveLength(2));
    expect(screen.getByText(`${firstAnswer.id}:up`)).toBeTruthy();
  });

  it("sends nothing for a branch without answers", async () => {
    const { server, view } = setup();
    render(view(branch.filter((message) => message.role !== "assistant")));
    // Give a stray request the chance to go out.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(server.asked).toEqual([]);
  });
});

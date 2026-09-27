import { expect, test } from "@playwright/test";

import { apiFor, eventually } from "../support/api";
import {
  composer,
  conversationIdOf,
  expectReply,
  send,
  userMessages,
} from "../support/chat";
import { makePdf } from "../support/pdf";
import { storageStateFor } from "../support/users";

const SEARCH_RESULT = /Tool result: .*heliotrope budget grew/;

// PLAN.md §11 M1 step 10: an uploaded PDF becomes searchable through the
// in-process job queue (parse, chunk, embed with the mock embedding model),
// and a plain chat searches its attachments with `file_search`.

test.use({ storageState: storageStateFor("ada") });

const REPORT = [
  "Quarterly report for the platform team.",
  "The heliotrope budget grew by twelve percent this quarter.",
];

test("a PDF attached to a chat is indexed and searchable, from the API and the chat", async ({
  baseURL,
  page,
}) => {
  const api = await apiFor(page, baseURL ?? "");
  await page.goto("/");
  await send(page, "A chat about the quarterly report");
  await expectReply(page, "Echo: A chat about the quarterly report");
  const conversationId = await conversationIdOf(page);

  const uploaded = await api.files.upload({
    conversationId,
    file: new File([new Uint8Array(makePdf(REPORT))], "quarterly-report.pdf", {
      type: "application/pdf",
    }),
    purpose: "attachment",
  });
  // Ingestion runs as a background job; the file reports when it's done.
  const ready = await eventually(
    () => api.files.get({ id: uploaded.id }),
    (file) => file.status.state === "ready" || file.status.state === "failed",
    { timeoutMs: 45_000 }
  );
  expect(ready.status).toMatchObject({
    embeddingModel: "mock:embed",
    state: "ready",
  });
  expect(
    ready.status.state === "ready" ? ready.status.chunkCount : 0
  ).toBeGreaterThan(0);

  const hits = await api.files.search({ query: "heliotrope budget" });
  expect(hits[0]?.filename).toBe("quarterly-report.pdf");
  expect(hits[0]?.text).toContain("heliotrope budget grew");

  // From the chat: the model calls `file_search` over the chat's attachment.
  await send(page, "[search:heliotrope budget] what happened to it?");
  await expectReply(page, SEARCH_RESULT);
});

// Attaching the PDF in the composer sends it with the message as a file
// part, and a model that can't take PDFs (any openai-compatible one, like
// Ollama or this suite's mock) fails the turn: "The conversation couldn't be
// prepared for the model." Plain chats should fall back to `file_search`
// over the attachment instead of inlining it. Found by 040; unfixed.
// biome-ignore lint/suspicious/noSkippedTests: a known bug (above), kept runnable for the fix.
test.fixme("a PDF attached in the composer goes with the message", async ({
  page,
}) => {
  await page.goto("/");
  await expect(composer(page)).toBeEditable();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Attach files" }).click();
  await (await chooser).setFiles({
    buffer: makePdf(REPORT),
    mimeType: "application/pdf",
    name: "attached-report.pdf",
  });
  await expect(page.getByText("attached-report.pdf")).toBeVisible();
  await send(page, "Here is the quarterly report");
  await expectReply(page, "Echo: Here is the quarterly report");
  await expect(userMessages(page).first()).toContainText("attached-report.pdf");
});

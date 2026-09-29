import { expect, test } from "@playwright/test";

import { apiFor, eventually } from "../support/api";
import {
  composerReady,
  conversationIdOf,
  expectReply,
  openWorkspace,
  send,
  userMessages,
} from "../support/chat";
import { makePdf } from "../support/pdf";
import { storageStateFor } from "../support/users";

const SEARCH_RESULT = /Tool result: .*heliotrope budget grew/;
const ATTACHED_RESULT = /Tool result: .*saffron forecast doubled/;

// PLAN.md §11 M1 step 10: an uploaded PDF becomes searchable through the
// in-process job queue (parse, chunk, embed with the mock embedding model),
// and a plain chat searches its attachments with `file_search`.

test.use({ storageState: storageStateFor("ada") });

const REPORT = [
  "Quarterly report for the platform team.",
  "The heliotrope budget grew by twelve percent this quarter.",
];
const ATTACHED = [
  "Annual outlook for the platform team.",
  "The saffron forecast doubled after the spring review.",
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

// Attached in the composer, the PDF goes with the message. The suite's
// model is openai-compatible, which reads no PDFs (044): the turn doesn't
// fail; the model is told a file came with it, and once the upload is
// indexed the chat searches it with `file_search`. It also lands in the
// chat's workspace, for the agent's tools and the Files panel (062).
test("a PDF attached in the composer goes with the message", async ({
  baseURL,
  page,
}) => {
  await page.goto("/");
  await composerReady(page);
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Attach files" }).click();
  await (await chooser).setFiles({
    buffer: makePdf(ATTACHED),
    mimeType: "application/pdf",
    name: "attached-report.pdf",
  });
  await expect(page.getByText("attached-report.pdf")).toBeVisible();
  await send(page, "Here is the quarterly report");
  await expectReply(page, "Echo: Here is the quarterly report");
  await expect(userMessages(page).first()).toContainText("attached-report.pdf");
  const panel = await openWorkspace(page);
  await expect(
    panel.getByRole("treeitem", { name: "attached-report.pdf" })
  ).toBeVisible();

  const api = await apiFor(page, baseURL ?? "");
  const conversationId = await conversationIdOf(page);
  const attached = await eventually(
    async () =>
      (await api.files.list({ conversationId, limit: 5 })).items.find(
        (file) => file.name === "attached-report.pdf"
      ),
    (file) => file?.status.state === "ready" || file?.status.state === "failed",
    { timeoutMs: 45_000 }
  );
  expect(attached?.status.state).toBe("ready");
  await send(page, "[search:saffron forecast] what does it say?");
  await expectReply(page, ATTACHED_RESULT);
});

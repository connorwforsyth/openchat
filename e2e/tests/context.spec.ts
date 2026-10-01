import { expect, test } from "@playwright/test";

import { apiFor, loadWorld } from "../support/api";
import {
  composerReady,
  contextChip,
  conversationIdOf,
  expectReply,
  lockedContext,
  pickTarget,
  send,
} from "../support/chat";
import { storageStateFor } from "../support/users";

// PLAN.md §11 M1 step 4: switch the chat context to Platform before the
// first message; the team's key pays, usage rolls up to Eng and the org, and
// the context locks once the message is sent. The `paid` provider only
// answers with a key from the chat's context (e2e/support/serve.ts).

test("a Platform chat is paid by Platform's key, rolls up, and locks its context", async ({
  baseURL,
  browser,
}) => {
  const world = await loadWorld();
  const adaContext = await browser.newContext({
    baseURL,
    storageState: storageStateFor("ada"),
  });
  const ada = await apiFor(adaContext, baseURL ?? "");
  // A throwaway value: the mock provider accepts any key.
  await ada.keys.create({
    apiKey: "e2e-team-key-not-a-secret",
    label: "Platform test key",
    provider: "paid",
    scope: { id: world.platform, type: "team" },
  });

  const benContext = await browser.newContext({
    baseURL,
    storageState: storageStateFor("ben"),
  });
  const page = await benContext.newPage();
  await page.goto("/");
  // A new chat's context is chosen in the composer (D14).
  await composerReady(page);
  await contextChip(page, "Personal").click();
  await page.getByRole("menuitemradio", { name: "Platform" }).click();
  await expect(contextChip(page, "Platform")).toBeVisible();

  // Pick the model only Platform's key can pay for.
  await pickTarget(page, { group: "paid", name: "echo" });

  await send(page, "Who pays for this?");
  await expectReply(page, "Echo: Who pays for this?");
  const conversationId = await conversationIdOf(page);

  // Locked: the context can't change after the first message. It leaves
  // the composer and shows, read-only, in the header's Share menu.
  await expect(contextChip(page, "Platform")).toBeHidden();
  const locked = await lockedContext(page);
  await expect(locked).toContainText("Platform");
  await expect(locked.getByRole("menuitemradio")).toHaveCount(0);
  await page.keyboard.press("Escape");
  const ben = await apiFor(benContext, baseURL ?? "");
  const chat = await ben.conversations.get({ id: conversationId });
  expect(chat.context).toEqual({ id: world.platform, type: "team" });
  expect(chat.contextLocked).toBe(true);
  await expect(
    ben.conversations.setContext({
      context: { type: "personal" },
      id: conversationId,
    })
  ).rejects.toMatchObject({ status: 409 });

  // Platform's key paid, and the spend shows for Platform, Eng and Acme.
  const benMe = await ben.me.get();
  const paid = await ada.usage.transactions({
    limit: 20,
    principalId: world.platform,
    principalType: "team",
  });
  const turn = paid.items.find(
    (item) => item.kind === "chat" && item.userId === benMe.user.id
  );
  expect(turn?.paidBy).toEqual({ id: world.platform, type: "team" });
  expect(turn?.model).toBe("paid:echo");
  const window = {
    from: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    to: new Date(Date.now() + 60 * 1000).toISOString(),
  };
  for (const principal of [
    { principalId: world.platform, principalType: "team" as const },
    { principalId: world.eng, principalType: "team" as const },
    { principalId: world.orgId, principalType: "org" as const },
  ]) {
    // biome-ignore lint/performance/noAwaitInLoops: three small reads, in order for a readable failure.
    const summary = await ada.usage.summary({
      ...principal,
      ...window,
      groupBy: "user",
    });
    expect(
      summary.rows.map((row) => row.key),
      `${principal.principalType} ${principal.principalId}`
    ).toContain(benMe.user.id);
  }
  await adaContext.close();
  await benContext.close();
});

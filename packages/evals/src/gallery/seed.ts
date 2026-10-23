#!/usr/bin/env bun
/**
 * Seeds the artifact gallery: one chat, owned by `--email`, with one
 * example of every built-in artifact kind (`./examples.ts`).
 *
 *   bun packages/evals/src/gallery/seed.ts --database-url <url>
 *     [--email demo@dots.local] [--title "Artifact gallery"]
 *
 * `DATABASE_URL` stands in for `--database-url`. Re-running replaces the
 * owner's chats with that title, so there is only ever one gallery.
 */
import { parseArgs } from "node:util";

import type { MessagePart } from "@workspace/contract/schemas/message-parts";
import { connect, type Db } from "@workspace/db/client";
import { saveArtifactVersion } from "@workspace/db/queries/artifacts";
import {
  createConversation,
  deleteConversation,
} from "@workspace/db/queries/conversations";
import { insertMessage, updateMessage } from "@workspace/db/queries/messages";
import { personalOrgOf } from "@workspace/db/queries/teams";
import { err, ok } from "@workspace/shared/result";

import { type StoredExample, storedGallery } from "./examples";

const USER_PROMPT =
  "We open the Northcote shop on 6 February. Can you put together everything we need for it in one go: the opening plan, budget, board deck, website, counter menu, brand mark and anything else you can make? I'd like to see one of every kind of artifact you can create.";

const OPENING =
  "Here's the Northcote kit: one of every kind of artifact I can make, all working from the same numbers (a $340k budget, builders on site from 9 November, and opening day on Saturday 6 February).";

const CLOSING =
  "The plan, budget and deck share their figures. If a quote changes, tell me the new number and I'll update all three.";

/**
 * Replaces `email`'s chats called `title` with a new one holding
 * `examples`: the user's ask, then one answer with a card per artifact.
 * One transaction, so a failure leaves the old gallery in place.
 */
const seed = (
  db: Db,
  examples: readonly StoredExample[],
  email: string,
  title: string
) =>
  db.transaction(async (tx) => {
    const owner = await tx.query.user.findFirst({
      where: { email: email.toLowerCase() },
    });
    if (!owner) {
      return err(
        `No user with the email ${email}. Sign up or seed them first.`
      );
    }
    const orgId = await personalOrgOf(tx, owner.id);
    if (!orgId) {
      return err(`${email} has no personal space.`);
    }
    const previous = await tx.query.conversation.findMany({
      where: { ownerId: { eq: owner.id }, title },
    });
    for (const old of previous) {
      // biome-ignore lint/performance/noAwaitInLoops: one transaction, one statement at a time.
      await deleteConversation(tx, old.id);
    }

    const chat = await createConversation(tx, {
      context: { id: orgId, type: "personal" },
      ownerId: owner.id,
      title,
    });
    const asked = await insertMessage(tx, {
      authorId: owner.id,
      conversationId: chat.id,
      parentId: null,
      parts: [{ text: USER_PROMPT, type: "text" }],
      role: "user",
    });
    if (!asked.ok) {
      throw new Error("the user message wasn't saved");
    }
    // Artifacts point at the message that made them, so the answer exists
    // first and gets its cards once they're saved, as a run's does.
    const answer = await insertMessage(tx, {
      authorId: null,
      conversationId: chat.id,
      parentId: asked.value.id,
      parts: [{ text: OPENING, type: "text" }],
      role: "assistant",
    });
    if (!answer.ok) {
      throw new Error("the assistant message wasn't saved");
    }

    const parts: MessagePart[] = [{ text: OPENING, type: "text" }];
    for (const example of examples) {
      // biome-ignore lint/performance/noAwaitInLoops: the cards keep the examples' order.
      const saved = await saveArtifactVersion(tx, {
        content: example.stored,
        conversationId: chat.id,
        kind: example.kind,
        language: example.language ?? null,
        messageId: answer.value.id,
        title: example.title,
      });
      if (!saved.ok) {
        throw new Error(`the ${example.kind} artifact wasn't saved`);
      }
      const { artifact, version } = saved.value;
      parts.push(
        { text: example.intro, type: "text" },
        {
          artifactId: artifact.id,
          kind: artifact.kind,
          title: artifact.title,
          type: "artifact-ref",
          versionId: version.id,
        }
      );
    }
    parts.push({ text: CLOSING, type: "text" });
    await updateMessage(tx, answer.value.id, { parts });
    return ok({
      artifacts: parts.flatMap((part) =>
        part.type === "artifact-ref"
          ? [{ id: part.artifactId, kind: part.kind, title: part.title }]
          : []
      ),
      chatId: chat.id,
      replaced: previous.length,
    });
  });

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

const { values } = parseArgs({
  options: {
    "database-url": { type: "string" },
    email: { default: "demo@dots.local", type: "string" },
    title: { default: "Artifact gallery", type: "string" },
  },
});
const url = values["database-url"] ?? process.env.DATABASE_URL;
if (!url) {
  fail(
    "Usage: bun packages/evals/src/gallery/seed.ts --database-url <url> [--email demo@dots.local] [--title …] (or set DATABASE_URL)"
  );
}
const gallery = storedGallery();
const invalid = gallery.flatMap((example) =>
  example.problems.map((problem) => `${example.kind}: ${problem}`)
);
if (invalid.length > 0) {
  fail(
    `The gallery has examples create_artifact would refuse:\n${invalid.join("\n")}`
  );
}
const connection = connect(url);
if (!connection.ok) {
  fail("--database-url must be a postgres:// URL.");
}
const { close, db: database } = connection.value;
try {
  const seeded = await seed(database, gallery, values.email, values.title);
  if (seeded.ok) {
    process.stdout.write(`${JSON.stringify(seeded.value, null, 2)}\n`);
  } else {
    process.stderr.write(`${seeded.error}\n`);
    process.exitCode = 1;
  }
} finally {
  await close();
}

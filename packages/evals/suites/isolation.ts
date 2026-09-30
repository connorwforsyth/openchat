import type { Matcher } from "../src/match";
import { SHOW_SYSTEM } from "../src/mock";
import { defineSuite, evalCase } from "../src/suite";
import {
  callOf,
  chatOf,
  sandboxIdOf,
  toolNames,
  uploadPdf,
  writeFile,
} from "./support";

// ben is in Acme, dee in Globex; they share no org, team or chat. Every
// case gives ben something, then has dee (or a signed-out client, or a
// viewer) reach for it through the same routes the app uses, by id. Each
// has a control: the same request as ben works, so a refusal isn't the
// route being broken for everyone.

/** Refused: not yours (403) or, better, not there as far as you can tell (404). */
const refused = (status: unknown): boolean => status === 403 || status === 404;

const allRefused = (names: readonly string[]): Matcher =>
  Object.fromEntries(names.map((name) => [name, refused]));

const statuses = async (
  calls: Readonly<Record<string, () => Promise<number>>>
): Promise<Record<string, number>> =>
  Object.fromEntries(
    await Promise.all(
      Object.entries(calls).map(
        async ([name, call]) => [name, await call()] as const
      )
    )
  );

const REPORT = ["The heliotrope budget grew by twelve percent this quarter."];
const FACT = "twelve percent";
const MEMORY = "- The vault code word is MAGPIE";

export const isolation = defineSuite({
  cases: [
    evalCase(
      "another org's user can't read a chat, its messages, its runs or its stream",
      async (t) => {
        const turn = await t.send("The merger code name is OSPREY.", {
          as: "ben",
        });
        const chat = chatOf(t);
        const dee = t.api("dee");
        const got = await statuses({
          chat: () => t.statusOf(() => dee.conversations.get({ id: chat })),
          list: () =>
            t.statusOf(() =>
              dee.messages.list({ conversationId: chat, limit: 10 })
            ),
          message: () =>
            t.statusOf(() => dee.messages.get({ id: turn.userMessageId })),
          participants: () =>
            t.statusOf(() => dee.conversations.participants({ id: chat })),
          path: () =>
            t.statusOf(() => dee.messages.path({ conversationId: chat })),
          run: () => t.statusOf(() => dee.runs.get({ id: turn.runId })),
          runs: () =>
            t.statusOf(() =>
              dee.runs.list({ conversationId: chat, limit: 10 })
            ),
          stream: async () => (await t.streamOf(turn, { as: "dee" })).status,
          tree: () =>
            t.statusOf(() => dee.messages.tree({ conversationId: chat })),
        });
        t.check(got, "dee's requests for ben's chat")
          .matches(allRefused(Object.keys(got)))
          .gate();

        const mine = await dee.conversations.list({ limit: 50 });
        t.check(
          mine.items.map((each) => each.id),
          "dee's chat list"
        )
          .not.includes(chat)
          .gate();
        const found = await dee.search.conversations({ query: "OSPREY" });
        t.check(found.items.length, "dee's search hits for ben's text")
          .equals(0)
          .gate();

        // Controls: it is there, and ben finds it.
        t.check(
          await t.statusOf(() =>
            t.api("ben").messages.path({ conversationId: chat })
          ),
          "ben reading his own chat"
        )
          .equals(200)
          .gate();
        const own = await t
          .api("ben")
          .search.conversations({ query: "OSPREY" });
        t.check(
          own.items.map((hit) => hit.conversationId),
          "ben's search hits"
        )
          .includes(chat)
          .gate();
      }
    ),

    evalCase(
      "another org's user can't send to a chat, or decide or stop its run",
      async (t) => {
        const waiting = await t.send("[script:one]", { as: "ben" });
        const chat = chatOf(t);
        const dee = t.api("dee");
        const toolCallId = waiting.pending[0]?.toolCallId ?? "";
        const got = await statuses({
          approve: () =>
            t.statusOf(() =>
              dee.runs.submitApprovals({
                decisions: [{ decision: { decision: "approve" }, toolCallId }],
                runId: waiting.runId,
              })
            ),
          cancel: () =>
            t.statusOf(() => dee.runs.cancel({ id: waiting.runId })),
          regenerate: () =>
            t.statusOf(() =>
              dee.runs.create({
                conversationId: chat,
                input: {
                  type: "regenerate",
                  userMessageId: waiting.userMessageId,
                },
              })
            ),
          send: () =>
            t.statusOf(() =>
              dee.runs.create({
                conversationId: chat,
                input: {
                  parentId: null,
                  parts: [{ text: "let me in", type: "text" }],
                  type: "message",
                },
              })
            ),
        });
        t.check(got, "dee's requests against ben's run")
          .matches(allRefused(Object.keys(got)))
          .gate();

        // Nothing moved: the change still waits on ben, and wasn't applied.
        const still = await t.settled({ as: "ben" });
        t.check(still.status, "ben's run").equals("awaiting_approval").gate();
        t.check(
          still.pending.map((each) => each.toolCallId),
          "what still waits"
        )
          .equals([toolCallId])
          .gate();
        t.check(await t.readFile("probe.txt", { as: "ben" }), "probe.txt")
          .equals(null)
          .gate();
        const branch = await t
          .api("ben")
          .messages.path({ conversationId: chat });
        t.check(branch.messages.length, "messages on ben's branch")
          .equals(2)
          .gate();
      }
    ),

    evalCase(
      "another org's user can't list, read, change or run anything in a chat's workspace",
      async (t) => {
        await writeFile(t, "secret.txt", "ben's notes\n", { as: "ben" });
        const chat = chatOf(t);
        const id = await sandboxIdOf(t, "ben");
        const dee = t.api("dee");
        const got = await statuses({
          delete: () =>
            t.statusOf(() =>
              dee.sandbox.deleteFile({
                conversationId: chat,
                path: "secret.txt",
              })
            ),
          destroy: () => t.statusOf(() => dee.sandbox.destroy({ id })),
          exec: () =>
            t.statusOf(() =>
              dee.sandbox.exec({ command: "cat secret.txt", id })
            ),
          get: () =>
            t.statusOf(() => dee.sandbox.get({ conversationId: chat })),
          list: () =>
            t.statusOf(() => dee.sandbox.listFiles({ id, path: "." })),
          read: () =>
            t.statusOf(() => dee.sandbox.readFile({ id, path: "secret.txt" })),
          reset: () => t.statusOf(() => dee.sandbox.reset({ id })),
          write: () =>
            t.statusOf(() =>
              dee.sandbox.writeFile({
                content: "dee was here\n",
                conversationId: chat,
                encoding: "utf8",
                path: "secret.txt",
              })
            ),
        });
        t.check(got, "dee's requests for ben's workspace")
          .matches(allRefused(Object.keys(got)))
          .gate();
        t.check(
          await t.readFile("secret.txt", { as: "ben" }),
          "ben's file afterwards"
        )
          .equals("ben's notes\n")
          .gate();
      }
    ),

    evalCase(
      "another org's user can't open an upload, and the index returns none of it",
      async (t) => {
        const file = await uploadPdf(t, "quarterly-report.pdf", REPORT, "ben");
        t.check(file.status.state, "ben's upload").equals("ready").gate();
        const dee = t.api("dee");
        const got = await statuses({
          content: async () =>
            (await t.user("dee").fetch(`/api/files/${file.id}/content`)).status,
          delete: () => t.statusOf(() => dee.files.delete({ id: file.id })),
          get: () => t.statusOf(() => dee.files.get({ id: file.id })),
          url: () => t.statusOf(() => dee.files.getUrl({ id: file.id })),
        });
        t.check(got, "dee's requests for ben's upload")
          .matches(allRefused(Object.keys(got)))
          .gate();
        // Other cases upload files too, so these are about this file: the
        // index may answer with the searcher's own, never with ben's.
        const hitFiles = async (
          who: "ada" | "ben" | "dee",
          fileIds?: readonly string[]
        ) =>
          (
            await t.api(who).files.search({
              ...(fileIds ? { fileIds: [...fileIds] } : {}),
              limit: 50,
              query: "heliotrope budget",
            })
          ).map((hit) => hit.fileId);
        t.check(await hitFiles("dee"), "the files dee's search hits")
          .not.includes(file.id)
          .gate();
        t.check(
          await hitFiles("dee", [file.id]),
          "the files dee's search hits, naming ben's file"
        )
          .equals([])
          .gate();
        // Same org as ben is not access either: the upload is ben's own.
        t.check(await hitFiles("ada"), "the files ada's search hits")
          .not.includes(file.id)
          .gate();

        // Controls.
        t.check(
          (await t.user("ben").fetch(`/api/files/${file.id}/content`)).status,
          "ben opening his upload"
        )
          .equals(200)
          .gate();
        t.check(await hitFiles("ben"), "the files ben's search hits")
          .includes(file.id)
          .gate();
      },
      { timeoutMs: 90_000 }
    ),

    evalCase(
      "file_search in another tenant's chat returns only that tenant's chunks",
      async (t) => {
        await uploadPdf(t, "quarterly-report.pdf", REPORT, "ben");
        // dee's own chat, with a file of her own so the tool is offered, close
        // enough in wording that the same query finds it.
        await t.newChat({ as: "dee" });
        const hers = await uploadPdf(
          t,
          "greenhouse.pdf",
          ["The heliotrope greenhouse budget is unchanged."],
          "dee"
        );
        const turn = await t.send("[search:heliotrope budget grew]", {
          as: "dee",
        });
        t.check(toolNames(turn), "tools called").equals(["file_search"]).gate();
        const output = callOf(turn, "file_search")?.output as
          | { readonly hits?: readonly { fileId: string; text: string }[] }
          | undefined;
        const hits = output?.hits ?? [];
        t.check(
          hits.map((hit) => hit.fileId),
          "the files dee's search hit"
        )
          .equals([hers.id])
          .gate();
        t.check(turn.text, "what dee's model was told")
          .not.includes(FACT)
          .gate();
      },
      { timeoutMs: 90_000 }
    ),

    evalCase(
      "one user's memory is never in another user's instructions",
      async (t) => {
        const ben = t.api("ben");
        const before = await ben.memory.get();
        try {
          await ben.memory.update({
            baseVersionId: before.versionId,
            content: MEMORY,
          });
          const own = await t.send(SHOW_SYSTEM, { as: "ben" });
          t.check(own.text, "ben's instructions (control)")
            .includes("MAGPIE")
            .gate();

          await t.newChat({ as: "dee" });
          const other = await t.send(SHOW_SYSTEM, { as: "dee" });
          t.check(other.text, "dee's instructions").includes("<memory>").gate();
          t.check(other.text, "dee's instructions")
            .not.includes("MAGPIE")
            .gate();
          t.check(
            (await t.api("dee").memory.get()).content,
            "dee's memory file"
          )
            .not.includes("MAGPIE")
            .gate();
        } finally {
          const now = await ben.memory.get();
          await ben.memory.update({
            baseVersionId: now.versionId,
            content: before.content,
          });
        }
      }
    ),

    evalCase(
      "a viewer of a shared chat can read it, and nothing else",
      async (t) => {
        const waiting = await t.send("[script:one]", { as: "ben" });
        const chat = chatOf(t);
        await t.api("ben").grants.create({
          permission: "viewer",
          principal: { id: t.user("ada").id, type: "user" },
          resourceId: chat,
          resourceType: "conversation",
        });
        const ada = t.api("ada");
        const seen = await ada.conversations.get({ id: chat });
        t.check(seen.myPermission, "ada's permission").equals("viewer").gate();
        t.check(
          (await ada.messages.path({ conversationId: chat })).messages.length,
          "messages ada can read"
        )
          .equals(2)
          .gate();

        const toolCallId = waiting.pending[0]?.toolCallId ?? "";
        const got = await statuses({
          approve: () =>
            t.statusOf(() =>
              ada.runs.submitApprovals({
                decisions: [{ decision: { decision: "approve" }, toolCallId }],
                runId: waiting.runId,
              })
            ),
          cancel: () =>
            t.statusOf(() => ada.runs.cancel({ id: waiting.runId })),
          send: () =>
            t.statusOf(() =>
              ada.runs.create({
                conversationId: chat,
                input: {
                  parentId: waiting.assistantMessageId,
                  parts: [{ text: "a viewer's message", type: "text" }],
                  type: "message",
                },
              })
            ),
          write: () =>
            t.statusOf(() =>
              ada.sandbox.writeFile({
                content: "x\n",
                conversationId: chat,
                encoding: "utf8",
                path: "viewer.txt",
              })
            ),
        });
        t.check(got, "the viewer's attempts to change the chat")
          .matches(allRefused(Object.keys(got)))
          .gate();
        const still = await t.settled({ as: "ben" });
        t.check(still.status, "ben's run").equals("awaiting_approval").gate();
        t.check(
          (await t.files({ as: "ben" })).map((file) => file.path),
          "workspace files"
        )
          .equals([])
          .gate();
        // Sharing with ada shares with nobody else.
        t.check(
          await t.statusOf(() => t.api("dee").conversations.get({ id: chat })),
          "dee reading the shared chat"
        )
          .matches(refused)
          .gate();
      }
    ),

    evalCase(
      "memory is left out of a shared chat, and nothing is saved from one",
      async (t) => {
        const ben = t.api("ben");
        const before = await ben.memory.get();
        try {
          const set = await ben.memory.update({
            baseVersionId: before.versionId,
            content: MEMORY,
          });
          const alone = await t.send(SHOW_SYSTEM, { as: "ben" });
          t.check(alone.text, "the instructions while the chat is private")
            .includes("MAGPIE")
            .gate();

          await ben.grants.create({
            permission: "viewer",
            principal: { id: t.user("ada").id, type: "user" },
            resourceId: chatOf(t),
            resourceType: "conversation",
          });
          const shared = await t.send(SHOW_SYSTEM, { as: "ben" });
          t.check(shared.text, "the instructions once it is shared")
            .not.includes("MAGPIE")
            .gate();
          t.check(shared.text, "the instructions once it is shared")
            .not.includes("<memory>")
            .gate();

          const asked = await t.send("remember that I like tabs", {
            as: "ben",
          });
          t.notCalledTool("update_memory", { in: asked }).gate();
          t.check((await ben.memory.get()).versionId, "ben's memory version")
            .equals(set.versionId)
            .gate();
        } finally {
          const now = await ben.memory.get();
          await ben.memory.update({
            baseVersionId: now.versionId,
            content: before.content,
          });
        }
      }
    ),

    evalCase(
      "being in the same org, or the instance's admin, is not access to a personal chat",
      async (t) => {
        const turn = await t.send("A personal note.", { as: "ben" });
        const chat = chatOf(t);
        // ada owns Acme, which ben is a member of, and is the instance admin.
        const ada = t.api("ada");
        const got = await statuses({
          chat: () => t.statusOf(() => ada.conversations.get({ id: chat })),
          path: () =>
            t.statusOf(() => ada.messages.path({ conversationId: chat })),
          run: () => t.statusOf(() => ada.runs.get({ id: turn.runId })),
          stream: async () => (await t.streamOf(turn, { as: "ada" })).status,
        });
        t.check(got, "ada's requests for ben's personal chat")
          .matches(allRefused(Object.keys(got)))
          .gate();
      }
    ),

    evalCase("a signed-out client gets nothing", async (t) => {
      const turn = await t.send("Anyone there?", { as: "ben" });
      const anonymous = (path: string) =>
        fetch(`${t.world.baseUrl}${path}`).then((response) => response.status);
      const got = await statuses({
        chat: () => anonymous(`/api/conversations/${turn.conversationId}`),
        memory: () => anonymous("/api/memory"),
        path: () => anonymous(`/api/conversations/${turn.conversationId}/path`),
        run: () => anonymous(`/api/runs/${turn.runId}`),
        stream: () => anonymous(`/api/runs/${turn.runId}/stream`),
      });
      t.check(got, "requests without a session")
        .equals({ chat: 401, memory: 401, path: 401, run: 401, stream: 401 })
        .gate();
    }),
  ],
  name: "isolation",
  proves:
    "Tenancy is enforced by the server, by id, on every route the app uses: a user in another org gets 403/404 for a chat's messages, runs, stream, workspace and uploads, can't send, approve or cancel, and finds nothing of it through conversation search, the file index or file_search; memory is per user and is left out of (and not written from) a shared chat; a viewer can read and nothing else; org membership and instance admin are not access to a personal chat; a signed-out client gets 401. Each refusal has a control showing the owner's same request works.",
});

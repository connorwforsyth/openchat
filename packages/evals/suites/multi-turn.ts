import { call, plan, SHOW_HISTORY } from "../src/mock";
import { defineSuite, evalCase } from "../src/suite";
import { callOf, chatOf, endOf, writeFile } from "./support";

// What a later turn is built from: the branch it is on, with its earlier
// tool results, and nothing from a sibling branch or a cancelled run.
// `[show:history]` makes the mock answer with the conversation the server
// sent it, one message per line.

const NOT_RUN = /^Not run/;

export const multiTurn = defineSuite({
  cases: [
    evalCase(
      "a follow-up is sent with the turns before it, in order",
      async (t) => {
        const first = await t.send("My project is called Heron.");
        const second = await t.send(SHOW_HISTORY);
        t.check(second.status, "run status").equals("succeeded").gate();
        t.check(second.text, "what the model was sent")
          .equals(
            [
              "History:",
              "user: My project is called Heron.",
              "assistant: Echo: My project is called Heron.",
              `user: ${SHOW_HISTORY}`,
            ].join("\n")
          )
          .gate();

        const branch = await t
          .api()
          .messages.path({ conversationId: chatOf(t) });
        t.check(
          branch.messages.map((message) => [message.role, message.parentId]),
          "the branch, each message under the one before"
        )
          .equals([
            ["user", null],
            ["assistant", first.userMessageId],
            ["user", first.assistantMessageId],
            ["assistant", second.userMessageId],
          ])
          .gate();
      }
    ),

    evalCase(
      "an earlier tool result is sent again with the next turn, not re-run",
      async (t) => {
        await writeFile(t, "notes.md", "Launch is on the fourth.\n");
        await t.send(plan(call("read", { path: "notes.md" })));
        const next = await t.send(SHOW_HISTORY);
        t.check(next.text, "what the model was sent")
          .includes('assistant: read({"path":"notes.md"})')
          .gate();
        t.check(next.text, "what the model was sent")
          .includes("Launch is on the fourth.")
          .gate();
        t.notCalledTool(undefined, { in: next }).gate();
      }
    ),

    evalCase(
      "editing a message starts a sibling branch that doesn't see the old one",
      async (t) => {
        const first = await t.send("Plan a trip to Lisbon.");
        const original = await t.send("Make it three days.");
        // An edit is a new message under the same parent as the one it replaces.
        const edited = await t.send(SHOW_HISTORY, {
          parentId: first.assistantMessageId,
        });
        t.check(edited.text, "what the model was sent on the new branch")
          .not.includes("Make it three days.")
          .gate();
        t.check(edited.text, "what the model was sent on the new branch")
          .includes("user: Plan a trip to Lisbon.")
          .gate();

        const api = t.api();
        const branch = await api.messages.path({ conversationId: chatOf(t) });
        t.check(
          branch.messages.map((message) => message.id),
          "the branch the chat shows now"
        )
          .equals([
            first.userMessageId,
            first.assistantMessageId,
            edited.userMessageId,
            edited.assistantMessageId,
          ])
          .gate();
        t.check(
          branch.siblings.find(
            (each) => each.messageId === edited.userMessageId
          ),
          "the edited message's siblings"
        )
          .matches({
            index: 1,
            siblingIds: [original.userMessageId, edited.userMessageId],
          })
          .gate();

        // The first version is still there, on its own branch.
        const old = await api.messages.path({
          conversationId: chatOf(t),
          ...(original.assistantMessageId
            ? { leafId: original.assistantMessageId }
            : {}),
        });
        t.check(old.messages.at(-1)?.id, "the old branch's leaf")
          .equals(original.assistantMessageId)
          .gate();
      }
    ),

    evalCase(
      "regenerate answers the same message again, beside the first answer",
      async (t) => {
        const first = await t.send("Name a bird.");
        const again = await t.regenerate();
        t.check(again.status, "run status").equals("succeeded").gate();
        t.check(again.userMessageId, "the message answered")
          .equals(first.userMessageId)
          .gate();
        t.check(again.assistantMessageId, "the new answer")
          .not.equals(first.assistantMessageId)
          .gate();
        t.check(again.text, "the new answer's text")
          .equals("Echo: Name a bird.")
          .gate();

        const tree = await t.api().messages.tree({ conversationId: chatOf(t) });
        t.check(
          tree.nodes
            .filter((node) => node.parentId === first.userMessageId)
            .map((node) => node.id),
          "the answers under the message"
        )
          .equals([first.assistantMessageId, again.assistantMessageId])
          .gate();
      }
    ),

    evalCase(
      "a new message while a change waits cancels that run, and the change is never applied",
      async (t) => {
        const waiting = await t.send("[script:one]");
        t.check(waiting.status, "the first run")
          .equals("awaiting_approval")
          .gate();

        const next = await t.send("never mind, leave it");
        t.check(next.status, "the second run").equals("succeeded").gate();
        t.check(next.text, "the second answer")
          .equals("Echo: never mind, leave it")
          .gate();

        const cancelled = await t.settled({ turn: waiting });
        t.check(cancelled.status, "the first run now")
          .equals("cancelled")
          .gate();
        const write = callOf(cancelled, "write");
        t.check(endOf(write), "the waiting write").equals("error").gate();
        t.check(write?.output, "what the write's result says")
          .matches(NOT_RUN)
          .gate();
        t.check(write?.approval, "the write's approval")
          .equals("pending")
          .gate();
        t.check(
          (await t.files()).map((file) => file.path),
          "workspace files"
        )
          .not.includes("probe.txt")
          .gate();

        // Deciding it now is too late.
        t.check(
          await t.statusOf(() =>
            t.api().runs.submitApprovals({
              decisions: [
                {
                  decision: { decision: "approve" },
                  toolCallId: write?.toolCallId ?? "",
                },
              ],
              runId: waiting.runId,
            })
          ),
          "approving the cancelled run's change"
        )
          .equals(409)
          .gate();
        t.check(await t.readFile("probe.txt"), "probe.txt")
          .equals(null)
          .gate();
      }
    ),

    evalCase(
      "a new message while an answer is still streaming waits its turn",
      async (t) => {
        const slow = await t.send("[slow] first", { wait: false });
        const queued = await t.send(SHOW_HISTORY, { wait: false });
        t.check(queued.status, "the second run, sent mid-answer")
          .equals("queued")
          .gate();

        const second = await t.settled({ turn: queued });
        const first = await t.settled({ turn: slow });
        t.check(first.status, "the first run").equals("succeeded").gate();
        t.check(second.status, "the second run").equals("succeeded").gate();
        t.check(second.text, "what the second turn was sent")
          .includes("assistant: Slow reply: word1 word2")
          .gate();
      }
    ),
  ],
  name: "multi-turn",
  proves:
    "A later turn is built from the right branch: the turns before it in order, earlier tool calls with their results, nothing from a sibling branch after an edit, a regenerated answer beside the first; a message sent while a change waits cancels that run and its change never lands (cancel-on-send), and one sent mid-answer queues behind it.",
});

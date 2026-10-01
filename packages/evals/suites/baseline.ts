import { defineSuite, evalCase, liveCase } from "../src/suite";

// Plain turns with no tools. The mock echoes, so nothing here is about the
// quality of an answer (that's the judged half, ticket 085).

const TOPIC = /^Topic /;
const WORD_40 = /word40 done\.$/;

const REWRITE = [
  "Rewrite this, keeping the list:",
  "",
  '- "quoted", `code` and <b>markup</b>',
  "- naïve café, 日本語, 🙂",
  "",
  "    indented line",
].join("\n");

export const baseline = defineSuite({
  cases: [
    evalCase(
      "greeting: the run succeeds, the stream completes, a title is made",
      async (t) => {
        const turn = await t.send("Hello there, how are you?");
        t.check(turn.status, "run status").equals("succeeded").gate();
        t.notCalledTool().gate();
        t.check(turn.text, "stored answer")
          .equals("Echo: Hello there, how are you?")
          .gate();
        t.check(turn.stream.done, "the stream ended with [DONE]")
          .equals(true)
          .gate();
        t.check(turn.stream.chunks.at(-1)?.type, "last chunk")
          .equals("finish")
          .gate();

        // The title job runs after the first answer.
        const chat = await t.eventually(
          () => t.api().conversations.get({ id: turn.conversationId }),
          (each) => each.title !== null
        );
        t.check(chat.title, "title").matches(TOPIC).gate();
        t.check(chat.title, "title").includes("Hello there,").gate();

        t.judge("The reply greets the user and answers the question.").soft();
      }
    ),

    evalCase(
      "factual question: the answer is stored on the branch with its model and usage",
      async (t) => {
        const turn = await t.send("What is the capital of France?");
        t.check(turn.status, "run status").equals("succeeded").gate();
        t.notCalledTool().gate();
        t.check(turn.run.resolvedModel, "resolved model")
          .equals("mock:echo")
          .gate();
        t.check(turn.run.usage, "usage")
          .matches({
            inputTokens: (tokens) => typeof tokens === "number" && tokens > 0,
            outputTokens: (tokens) => typeof tokens === "number" && tokens > 0,
          })
          .gate();

        const branch = await t.api().messages.path({
          conversationId: turn.conversationId,
        });
        t.check(
          branch.messages.map((message) => [message.role, message.status]),
          "branch"
        )
          .equals([
            ["user", "complete"],
            ["assistant", "complete"],
          ])
          .gate();
        const [question, answer] = branch.messages;
        t.check(question?.authorId, "the question's author")
          .equals(t.user("ada").id)
          .gate();
        t.check(answer?.parentId, "the answer's parent")
          .equals(turn.userMessageId)
          .gate();
        t.check(answer?.model, "the answer's model").equals("mock:echo").gate();
      }
    ),

    evalCase(
      "rewrite: text goes through the API, the store and the stream unchanged",
      async (t) => {
        const turn = await t.send(REWRITE);
        t.check(turn.status, "run status").equals("succeeded").gate();
        t.notCalledTool().gate();
        t.check(turn.text, "stored answer").equals(`Echo: ${REWRITE}`).gate();
        const streamed = turn.stream.chunks
          .flatMap((chunk) =>
            chunk.type === "text-delta" ? [chunk.delta] : []
          )
          .join("");
        t.check(streamed, "streamed text").equals(turn.text).gate();
        const stored = await t.api().messages.get({ id: turn.userMessageId });
        t.check(stored.parts, "the stored question")
          .equals([{ text: REWRITE, type: "text" }])
          .gate();
      }
    ),

    evalCase(
      "long-form: a long answer arrives token by token and is stored whole",
      async (t) => {
        const turn = await t.send("[slow] Write a long answer.");
        t.check(turn.status, "run status").equals("succeeded").gate();
        t.notCalledTool().gate();
        t.check(turn.text, "stored answer").matches(WORD_40).gate();
        const deltas = turn.stream.chunks.flatMap((chunk) =>
          chunk.type === "text-delta" ? [chunk.delta] : []
        );
        t.check(deltas.length >= 40, "at least 40 text chunks were streamed")
          .equals(true)
          .gate();
        t.check(deltas.join(""), "streamed text").equals(turn.text).gate();
        t.check(turn.stream.done, "the stream ended with [DONE]")
          .equals(true)
          .gate();
      }
    ),

    // Live only (a real model and a judge): the helpfulness and
    // faithfulness rubric the mock can't be asked about.
    liveCase(
      "live: a factual question gets a correct, direct answer",
      async (t) => {
        const turn = await t.send(
          "What is the capital of Australia, and why isn't it Sydney? Two sentences."
        );
        t.check(turn.status, "run status").equals("succeeded").soft();
        t.notCalledTool().soft();
        t.judge(
          "Helpful and faithful: the reply says the capital is Canberra, gives a brief true reason it isn't Sydney (for example, Canberra was chosen as a compromise between Sydney and Melbourne), and states nothing false."
        );
      }
    ),

    liveCase("live: a rewrite keeps the meaning and the list", async (t) => {
      const turn = await t.send(
        [
          "Rewrite this for a customer, politely, keeping it a two-item list:",
          "",
          "- fix ships tmrw, prob before noon",
          "- if it breaks again ping us",
        ].join("\n")
      );
      t.check(turn.status, "run status").equals("succeeded").soft();
      t.notCalledTool().soft();
      t.judge(
        "Helpful and faithful: the reply is a polite two-item list that keeps both points (the fix ships tomorrow, probably before noon; contact us if it breaks again) and adds no promise or fact the original didn't make."
      );
    }),
  ],
  name: "baseline",
  proves:
    "A plain turn works end to end over HTTP: the run succeeds with no tool calls, its stream delivers the stored text and ends, the branch is stored with its author, model and usage, and the title job names the chat. The mock echoes, so nothing here measures answer quality.",
});

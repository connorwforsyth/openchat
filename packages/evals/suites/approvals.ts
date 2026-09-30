import type { UIMessageChunk } from "ai";

import type { Turn } from "../src/harness";
import { call, plan } from "../src/mock";
import { defineSuite, evalCase } from "../src/suite";
import { callOf, chatOf, endOf } from "./support";

// The approval harness (072) at the level of the API: what the run row, the
// stored calls and the stream say as changes are approved, rejected,
// stopped, reloaded and decided from two places. e2e/tests/harness.spec.ts
// checks the same flows as a person sees them, in the browser; this checks
// the contract underneath, which every client (web, desktop, Swift) builds
// on. The scripts are the mock's `SCRIPTS` (site, site-batch, one).

const SITE = ["index.html", "style.css", "script.js"];
const SITE_DONE = /^Script site done/;
const BATCH_DONE = /^Script site-batch done/;
const NOT_RUN = /^Not run/;
const STOPPED = /^Stopped by the user before it finished\./;

/** The file each pending change is for. */
const waitingOn = (turn: Turn): readonly string[] =>
  turn.pending.map((each) => each.edits?.[0]?.path ?? each.toolName);

/** The tool calls the stream asked a person about, in order. */
const asked = (chunks: readonly UIMessageChunk[]): readonly string[] =>
  chunks.flatMap((chunk) =>
    chunk.type === "tool-approval-request" ? [chunk.toolCallId] : []
  );

const writes = (turn: Turn) =>
  turn.toolCalls
    .filter((each) => each.name === "write")
    .map((each) => [each.approval, endOf(each)]);

const paths = async (t: {
  files: () => Promise<readonly { path: string }[]>;
}) => (await t.files()).map((file) => file.path).sort();

/** The status and conflict reason a request is refused with; `200` if it isn't. */
const refusal = async (
  request: () => Promise<unknown>
): Promise<{ readonly reason?: unknown; readonly status: number }> => {
  try {
    await request();
    return { status: 200 };
  } catch (cause) {
    const error = cause as {
      readonly data?: { readonly reason?: unknown };
      readonly status?: number;
    };
    if (typeof error.status !== "number") {
      throw cause;
    }
    return { reason: error.data?.reason, status: error.status };
  }
};

const isRunning = (chunks: readonly UIMessageChunk[]): boolean =>
  chunks.some((chunk) => chunk.type === "tool-input-available");

export const approvals = defineSuite({
  cases: [
    evalCase(
      "sequential writes: each change is asked about once, in order, and lands when approved",
      async (t) => {
        let turn = await t.send("[script:site]");
        const seen: (readonly string[])[] = [];
        while (turn.status === "awaiting_approval") {
          seen.push(waitingOn(turn));
          // biome-ignore lint/performance/noAwaitInLoops: one approval at a time, in order.
          turn = await t.approve();
        }
        t.check(seen, "what waited, step by step")
          .equals(SITE.map((path) => [path]))
          .gate();
        t.check(turn.status, "run status").equals("succeeded").gate();
        t.check(turn.text, "the answer").matches(SITE_DONE).gate();
        t.check(writes(turn), "the writes")
          .equals(SITE.map(() => ["approve", "success"]))
          .gate();
        t.check(await paths(t), "workspace files")
          .equals([...SITE].sort())
          .gate();
        // Zero duplicate or hidden prompts: one request per change on the wire.
        const requests = asked(turn.stream.chunks);
        t.check(requests.length, "approval requests in the stream")
          .equals(3)
          .gate();
        t.check(new Set(requests).size, "distinct calls asked about")
          .equals(3)
          .gate();
        t.check(turn.stream.done, "the stream ended").equals(true).gate();
      }
    ),

    evalCase(
      "parallel writes: all three wait at once, a partial decision holds, and a flipped decision is a 409",
      async (t) => {
        const turn = await t.send("[script:site-batch]");
        t.check(waitingOn(turn), "what waits").equals(SITE).gate();
        t.check(
          asked(turn.stream.chunks).length,
          "approval requests in the stream"
        )
          .equals(3)
          .gate();
        const [first, second, third] = turn.pending.map(
          (each) => each.toolCallId
        );
        const decide = (
          toolCallId: string | undefined,
          decision: "approve" | "reject"
        ) =>
          refusal(() =>
            t.api().runs.submitApprovals({
              decisions: [
                { decision: { decision }, toolCallId: toolCallId ?? "" },
              ],
              runId: turn.runId,
            })
          );

        const partial = await t.approve({ only: [first ?? ""] });
        t.check(partial.status, "run status after one decision")
          .equals("awaiting_approval")
          .gate();
        t.check(waitingOn(partial), "what still waits")
          .equals(SITE.slice(1))
          .gate();
        t.check(await paths(t), "workspace files before every call is decided")
          .equals([])
          .gate();

        t.check(await decide(first, "approve"), "the same decision again")
          .equals({ status: 200 })
          .gate();
        t.check(await decide(first, "reject"), "the opposite decision")
          .equals({ reason: "not_awaiting_approval", status: 409 })
          .gate();
        t.check(
          (await decide("call_nope", "approve")).status,
          "deciding a call that doesn't exist"
        )
          .equals(422)
          .gate();

        await t.reject("not this one", { only: [second ?? ""] });
        const done = await t.approve({ only: [third ?? ""] });
        t.check(done.status, "run status").equals("succeeded").gate();
        t.check(done.text, "the answer").matches(BATCH_DONE).gate();
        t.check(writes(done), "the writes")
          .equals([
            ["approve", "success"],
            ["reject", "denied"],
            ["approve", "success"],
          ])
          .gate();
        t.check(await paths(t), "workspace files")
          .equals(["index.html", "script.js"])
          .gate();
        t.check(
          asked(done.stream.chunks).length,
          "approval requests in the stream, in all"
        )
          .equals(3)
          .gate();
      }
    ),

    evalCase(
      "reject all: every change is denied, nothing lands, and the run carries on",
      async (t) => {
        let turn = await t.send("[script:site]");
        while (turn.status === "awaiting_approval") {
          // biome-ignore lint/performance/noAwaitInLoops: one decision at a time, in order.
          turn = await t.reject();
        }
        t.check(turn.status, "run status").equals("succeeded").gate();
        t.check(turn.text, "the answer").matches(SITE_DONE).gate();
        t.check(writes(turn), "the writes")
          .equals(SITE.map(() => ["reject", "denied"]))
          .gate();
        t.check(await paths(t), "workspace files")
          .equals([])
          .gate();
      }
    ),

    evalCase(
      "Stop while a change waits: the run is cancelled, the change never runs, and late decisions are 409s",
      async (t) => {
        const waiting = await t.send("[script:one]");
        t.check(waiting.status, "run status")
          .equals("awaiting_approval")
          .gate();
        const stopped = await t.stop();
        t.check(stopped.run.state, "the run afterwards")
          .matches({ cancelledBy: t.user("ada").id, status: "cancelled" })
          .gate();
        const write = callOf(stopped, "write");
        t.check([write?.approval, endOf(write)], "the waiting write")
          .equals(["pending", "error"])
          .gate();
        t.check(write?.output, "what the write's result says")
          .matches(NOT_RUN)
          .gate();
        t.check(await t.readFile("probe.txt"), "probe.txt")
          .equals(null)
          .gate();
        t.check(stopped.stream.done, "the stream ended").equals(true).gate();

        t.check(
          await refusal(() =>
            t.api().runs.submitApprovals({
              decisions: [
                {
                  decision: { decision: "approve" },
                  toolCallId: write?.toolCallId ?? "",
                },
              ],
              runId: stopped.runId,
            })
          ),
          "approving after Stop"
        )
          .equals({ reason: "not_awaiting_approval", status: 409 })
          .gate();
        t.check(
          await refusal(() => t.api().runs.cancel({ id: stopped.runId })),
          "stopping again"
        )
          .equals({ reason: "run_finished", status: 409 })
          .gate();
        const active = await t.api().runs.list({
          active: true,
          conversationId: chatOf(t),
          limit: 5,
        });
        t.check(active.items, "runs still going").equals([]).gate();
      }
    ),

    evalCase(
      "Stop during a running command kills it rather than waiting it out",
      async (t) => {
        const started = await t.send(
          plan(
            call("bash", { command: "echo started; sleep 30; echo woke-late" })
          ),
          { wait: false }
        );
        await t.eventually(
          () => t.streamOf(started),
          (stream) => isRunning(stream.chunks)
        );
        const at = Date.now();
        const stopped = await t.stop();
        // Killed, not waited out.
        t.check(Date.now() - at < 10_000, "stopped within 10 s")
          .equals(true)
          .gate();
        t.check(stopped.status, "run status").equals("cancelled").gate();
        const bash = callOf(stopped, "bash");
        t.check([bash?.approval, endOf(bash)], "the command")
          .equals(["not-required", "error"])
          .gate();
        t.check(bash?.output, "what the command's result says")
          .matches(STOPPED)
          .gate();
        t.check(String(bash?.output), "what the command's result says")
          .not.includes("woke-late")
          .gate();
        t.check(stopped.stream.done, "the stream ended").equals(true).gate();
      }
    ),

    evalCase(
      "reload during a pause and after: the stream replays exactly what was live",
      async (t) => {
        const waiting = await t.send("[script:site]");
        const paused = await t.reload();
        t.check(
          paused.activeRuns.map((run) => [run.id, run.state.status]),
          "the runs a loading page finds"
        )
          .equals([[waiting.runId, "awaiting_approval"]])
          .gate();
        t.check(waitingOn(paused.turn), "what waits after the reload")
          .equals(["index.html"])
          .gate();
        t.check(paused.replay.chunks, "the replayed stream")
          .equals(waiting.stream.chunks)
          .gate();
        t.check(paused.replay.seqs, "the replay's sequence numbers")
          .equals(paused.replay.chunks.map((_chunk, index) => index + 1))
          .gate();
        t.check(
          asked(paused.replay.chunks).length,
          "approval requests in the replay"
        )
          .equals(1)
          .gate();
        t.check(paused.replay.done, "the replay of a paused run ended")
          .equals(false)
          .gate();

        // Decide right after the reload; the next change still comes.
        const next = await t.approve();
        t.check(waitingOn(next), "what waits next")
          .equals(["style.css"])
          .gate();
        const again = await t.reload();
        t.check(
          asked(again.replay.chunks).length,
          "approval requests in the second replay"
        )
          .equals(2)
          .gate();

        let turn = next;
        while (turn.status === "awaiting_approval") {
          // biome-ignore lint/performance/noAwaitInLoops: one approval at a time, in order.
          turn = await t.approve();
        }
        const finished = await t.reload();
        t.check(finished.activeRuns, "runs still going").equals([]).gate();
        t.check(finished.replay.done, "the replay of the finished run ended")
          .equals(true)
          .gate();
        t.check(finished.replay.chunks, "the whole run, replayed")
          .equals(turn.stream.chunks)
          .gate();
        t.check(
          finished.messages.map((message) => [message.role, message.status]),
          "the stored branch"
        )
          .equals([
            ["user", "complete"],
            ["assistant", "complete"],
          ])
          .gate();
      }
    ),

    evalCase(
      "reload while a command runs: the page finds it running, then its result",
      async (t) => {
        const started = await t.send(
          plan(call("bash", { command: "sleep 2; echo woke-up" })),
          { wait: false }
        );
        await t.eventually(
          () => t.streamOf(started),
          (stream) => isRunning(stream.chunks)
        );
        const during = await t.reload();
        t.check(
          during.activeRuns.map((run) => [run.id, run.state.status]),
          "the runs a loading page finds"
        )
          .equals([[started.runId, "running"]])
          .gate();
        t.check(isRunning(during.replay.chunks), "the replay shows the command")
          .equals(true)
          .gate();
        t.check(during.replay.done, "the replay of a running run ended")
          .equals(false)
          .gate();

        const done = await t.settled();
        t.check(done.status, "run status").equals("succeeded").gate();
        t.check(callOf(done, "bash")?.output, "the command's result")
          .matches({ exitCode: 0, stdout: "woke-up\n" })
          .gate();
      }
    ),

    evalCase(
      "two tabs: a decision from one reaches the other, a cursor resumes, and the same decision twice runs once",
      async (t) => {
        // The harness's own stream reader is the first tab.
        const waiting = await t.send("[script:site]");
        const { runId } = waiting;
        const approve = (toolCallId: string) =>
          refusal(() =>
            t.api().runs.submitApprovals({
              decisions: [{ decision: { decision: "approve" }, toolCallId }],
              runId,
            })
          );

        // The second tab decides index.html; the first hears of it and moves on.
        const seenBefore = waiting.stream.chunks.length;
        await approve(waiting.pending[0]?.toolCallId ?? "");
        const next = await t.settled();
        t.check(waitingOn(next), "what the first tab waits on now")
          .equals(["style.css"])
          .gate();
        t.check(
          next.stream.chunks.slice(seenBefore).map((chunk) => chunk.type),
          "what the first tab's stream delivered meanwhile"
        )
          .includes("tool-approval-response")
          .gate();

        // A tab that reconnects from where it was gets only what it missed.
        const resumed = await t.streamOf(next, { cursor: seenBefore });
        t.check(resumed.seqs[0], "the first sequence number after the cursor")
          .equals(seenBefore + 1)
          .gate();
        t.check(resumed.chunks, "what the resumed stream delivered")
          .equals(next.stream.chunks.slice(seenBefore))
          .gate();

        // Both tabs approve style.css at the same moment.
        const style = next.pending[0]?.toolCallId ?? "";
        const both = await Promise.all([approve(style), approve(style)]);
        t.check(both, "the two identical decisions")
          .equals([{ status: 200 }, { status: 200 }])
          .gate();
        let turn = await t.settled();
        while (turn.status === "awaiting_approval") {
          // biome-ignore lint/performance/noAwaitInLoops: one approval at a time, in order.
          turn = await t.approve();
        }
        t.check(turn.status, "run status").equals("succeeded").gate();
        t.check(writes(turn), "the writes")
          .equals(SITE.map(() => ["approve", "success"]))
          .gate();
        const outputs = turn.stream.chunks.flatMap((chunk) =>
          chunk.type === "tool-output-available" ? [chunk.toolCallId] : []
        );
        t.check(
          outputs.filter((id) => id === style).length,
          "results for the change both tabs approved"
        )
          .equals(1)
          .gate();
        t.check(
          asked(turn.stream.chunks).length,
          "approval requests in the stream"
        )
          .equals(3)
          .gate();
      }
    ),

    evalCase(
      "any editor of a shared chat may decide, and the decision is recorded as theirs",
      async (t) => {
        const waiting = await t.send("[script:one]", { as: "ben" });
        await t.api("ben").grants.create({
          permission: "editor",
          principal: { id: t.user("ada").id, type: "user" },
          resourceId: chatOf(t),
          resourceType: "conversation",
        });
        const done = await t.approve({ as: "ada" });
        t.check(done.status, "run status").equals("succeeded").gate();
        t.check(await t.readFile("probe.txt", { as: "ben" }), "probe.txt")
          .equals("probe\n")
          .gate();
        const answer = waiting.assistantMessageId
          ? await t.api("ben").messages.get({ id: waiting.assistantMessageId })
          : null;
        const decidedBy = (answer?.parts ?? []).flatMap((part) =>
          part.type === "tool-call" && part.approval.state === "decided"
            ? [part.approval.decidedBy]
            : []
        );
        t.check(decidedBy, "who decided")
          .equals([t.user("ada").id])
          .gate();
      }
    ),
  ],
  name: "approvals",
  proves:
    "The approval contract under every client: a change that needs approval pauses the run and is asked about exactly once on the stream; decisions are idempotent and a flipped one is a 409; partial decisions hold the run; rejected and stopped changes never land; Stop kills a running command; a reload or a second connection replays exactly what was live and a cursor resumes after it; any editor may decide. The mock plays fixed scripts, so this is about the server, not a model.",
});

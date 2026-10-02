import { mockResults } from "../../../e2e/support/mock-search";
import { call, plan, resultArg, unofferedCall } from "../src/mock";
import { defineSuite, evalCase, liveCase } from "../src/suite";
import {
  callOf,
  chatOf,
  endOf,
  toolNames,
  uploadPdf,
  writeFile,
} from "./support";

// "The model chose the right tool" is scripted here: the mock calls what the
// message names. What these cases check is everything after the choice: the
// tool is offered on a plain chat, the call is stored with the arguments the
// model gave, the approval policy for that tool applies, the tool runs in
// the chat's workspace, and its result goes back to the model.

const PAGE = "<!doctype html><title>Hi</title><h1>Hello</h1>\n";
const INSIDE_WORK = /^(?!\/)(?!.*\.\.)|^\/work\//;
const ERROR = /error/;
const PLAN_DONE = /^Plan done after 1 steps\./;
const FIRST_IMAGE = "images/a-lighthouse-at-dusk-1.png";
/** A PNG's first bytes, as the harness reads a binary file (latin1). */
const PNG_SIGNATURE = "\x89PNG";

export const tools = defineSuite({
  cases: [
    evalCase(
      '"make index.html": write is offered, asks first, and lands only once approved',
      async (t) => {
        const asked = await t.send(
          plan(call("write", { content: PAGE, path: "index.html" }))
        );
        t.calledTool("write", { content: PAGE, path: INSIDE_WORK }).gate();
        t.check(toolNames(asked), "tools called").equals(["write"]).gate();
        t.check(asked.status, "run status").equals("awaiting_approval").gate();
        t.check(asked.pending[0]?.edits?.[0]?.path, "the proposed edit's path")
          .equals("index.html")
          .gate();
        t.check(asked.pending[0]?.edits?.[0]?.patch, "the proposed patch")
          .includes("+<!doctype html><title>Hi</title><h1>Hello</h1>")
          .gate();
        t.check(await t.readFile("index.html"), "the file before approval")
          .equals(null)
          .gate();

        const done = await t.approve();
        t.check(done.status, "run status after approval")
          .equals("succeeded")
          .gate();
        t.check(callOf(done, "write")?.approval, "the write's approval")
          .equals("approve")
          .gate();
        t.check(callOf(done, "write")?.output, "the write's result")
          .matches({ applied: ["h1"], status: "changed" })
          .gate();
        t.check(await t.readFile("index.html"), "the file after approval")
          .equals(PAGE)
          .gate();
      }
    ),

    evalCase(
      '"run the tests": bash runs without asking, in the workspace, and a failing command is a result',
      async (t) => {
        await writeFile(t, "test.sh", "echo ok 1 - adds\n");
        const ran = await t.send(
          plan(call("bash", { command: "sh test.sh && pwd" }))
        );
        t.calledTool("bash", { command: "sh test.sh && pwd" }).gate();
        t.check(toolNames(ran), "tools called").equals(["bash"]).gate();
        t.check(ran.status, "run status").equals("succeeded").gate();
        t.check(callOf(ran, "bash")?.approval, "bash's approval")
          .equals("not-required")
          .gate();
        t.check(callOf(ran, "bash")?.output, "bash's result")
          .matches({
            exitCode: 0,
            status: "ran",
            stdout: "ok 1 - adds\n/work\n",
          })
          .gate();
        t.check(ran.text, "what the model was told")
          .includes("ok 1 - adds")
          .gate();

        const failing = await t.send(plan(call("bash", { command: "exit 3" })));
        t.check(failing.status, "run status for a failing command")
          .equals("succeeded")
          .gate();
        t.check(callOf(failing, "bash")?.output, "the failing command's result")
          .matches({ exitCode: 3, status: "ran" })
          .gate();
      }
    ),

    evalCase(
      '"what\'s in notes.md": read runs without asking and returns the file',
      async (t) => {
        await writeFile(
          t,
          "notes.md",
          "Launch is on the fourth.\nBring cake.\n"
        );
        const turn = await t.send(plan(call("read", { path: "notes.md" })));
        t.calledTool("read", { path: "notes.md" }).gate();
        t.check(toolNames(turn), "tools called").equals(["read"]).gate();
        t.check(callOf(turn, "read")?.approval, "read's approval")
          .equals("not-required")
          .gate();
        t.check(callOf(turn, "read")?.output, "read's result")
          .matches({
            content: "Launch is on the fourth.\nBring cake.\n",
            status: "read",
            truncated: false,
          })
          .gate();
        t.check(turn.text, "what the model was told").matches(PLAN_DONE).gate();
        t.check(turn.text, "what the model was told")
          .includes("Launch is on the fourth.")
          .gate();

        const ranged = await t.send(
          plan(call("read", { limit: 1, offset: 2, path: "/work/notes.md" }))
        );
        t.check(callOf(ranged, "read")?.output, "a line range")
          .matches({ content: "Bring cake.", status: "read" })
          .gate();
      }
    ),

    evalCase(
      '"search my files": file_search is offered once the chat has a file, and takes the query',
      async (t) => {
        // Nothing attached: there's nothing to search, so the tool isn't offered.
        const before = await t.send("[search:heliotrope budget]");
        t.notCalledTool("file_search", { in: before }).gate();
        t.check(before.text, "the answer with nothing attached")
          .includes("Echo:")
          .gate();

        const file = await uploadPdf(t, "quarterly-report.pdf", [
          "Quarterly report for the platform team.",
          "The heliotrope budget grew by twelve percent this quarter.",
        ]);
        t.check(file.status.state, "the upload's indexing")
          .equals("ready")
          .gate();

        const turn = await t.send("[search:heliotrope budget] what happened?");
        t.calledTool(
          "file_search",
          { query: "heliotrope budget" },
          { in: turn }
        ).gate();
        t.check(toolNames(turn), "tools called").equals(["file_search"]).gate();
        t.check(callOf(turn, "file_search")?.approval, "file_search's approval")
          .equals("not-required")
          .gate();
        t.check(callOf(turn, "file_search")?.output, "file_search's result")
          .matches({
            hits: [{ fileId: file.id, filename: "quarterly-report.pdf" }],
            status: "ok",
          })
          .gate();
      },
      { timeoutMs: 90_000 }
    ),

    evalCase(
      '"search the web": web_search runs over the configured backend, and the composer\'s switch withholds it',
      async (t) => {
        const [guide, notes] = mockResults("quokka habitats");
        const turn = await t.send(
          plan(call("web_search", { query: "quokka habitats" }))
        );
        t.calledTool("web_search", { query: "quokka habitats" }).gate();
        t.check(toolNames(turn), "tools called").equals(["web_search"]).gate();
        t.check(callOf(turn, "web_search")?.approval, "web_search's approval")
          .equals("not-required")
          .gate();
        t.check(callOf(turn, "web_search")?.output, "web_search's result")
          .matches({
            results: [
              { title: guide.title, url: guide.url },
              { title: notes.title, url: notes.url },
            ],
            status: "ok",
          })
          .gate();
        t.check(turn.text, "what the model was told")
          .includes(guide.content)
          .gate();

        const off = await t.send(
          plan(call("web_search", { query: "numbats" })),
          { run: { webSearch: "off" } }
        );
        t.notCalledTool("web_search", { in: off }).gate();
        t.check(off.status, "run status with web search off")
          .equals("succeeded")
          .gate();
      }
    ),

    evalCase(
      '"draw a lighthouse": generate_image asks first, then keeps each picture in the workspace and the artifacts (138)',
      async (t) => {
        const ask = { count: 2, prompt: "A lighthouse at dusk" };
        const asked = await t.send(plan(call("generate_image", ask)));
        t.calledTool("generate_image", ask).gate();
        t.check(asked.status, "run status").equals("awaiting_approval").gate();
        t.check(await t.readFile(FIRST_IMAGE), "the picture before approval")
          .equals(null)
          .gate();

        const done = await t.approve();
        t.check(done.status, "run status after approval")
          .equals("succeeded")
          .gate();
        t.check(
          callOf(done, "generate_image")?.output,
          "generate_image's result"
        )
          .matches({
            images: [
              {
                artifact: { kind: "image", title: "A lighthouse at dusk (1)" },
                mediaType: "image/png",
                path: FIRST_IMAGE,
              },
              {
                artifact: { kind: "image", title: "A lighthouse at dusk (2)" },
                path: "images/a-lighthouse-at-dusk-2.png",
              },
            ],
            model: "Pixel",
            status: "generated",
          })
          .gate();
        t.check(
          (await t.readFile(FIRST_IMAGE))?.startsWith(PNG_SIGNATURE),
          "the picture in the workspace is a PNG"
        )
          .equals(true)
          .gate();
        t.check(done.text, "what the model was told")
          .includes("Made 2 images with Pixel")
          .gate();

        // Planning only reads: the tool isn't there to call.
        const planning = await t.send(
          plan(call("generate_image", { prompt: "A second lighthouse" })),
          { run: { mode: "plan" } }
        );
        t.notCalledTool("generate_image", { in: planning }).gate();
      }
    ),

    evalCase(
      "the composer's workspace switch withholds the file tools for that turn",
      async (t) => {
        const off = await t.send(
          plan(
            call("write", { content: "x\n", path: "x.txt" }),
            call("bash", { command: "echo hi > y.txt" })
          ),
          { run: { sandbox: "off" } }
        );
        t.notCalledTool().gate();
        t.check(off.status, "run status").equals("succeeded").gate();
        t.check(await t.files(), "workspace files")
          .equals([])
          .gate();
      }
    ),

    evalCase(
      "an MCP tool nobody attached to the chat asks before it is called",
      async (t) => {
        const asked = await t.send(
          plan(call("e2e__echo", { text: "hello from the mock server" }))
        );
        t.calledTool("e2e__echo", {
          text: "hello from the mock server",
        }).gate();
        t.check(asked.status, "run status").equals("awaiting_approval").gate();
        t.check(endOf(callOf(asked, "e2e__echo")), "the call while it waits")
          .equals("none")
          .gate();

        const done = await t.approve();
        t.check(done.status, "run status after approval")
          .equals("succeeded")
          .gate();
        t.check(callOf(done, "e2e__echo")?.output, "the MCP tool's result")
          .matches({
            content: [{ text: "hello from the mock server", type: "text" }],
            isError: false,
          })
          .gate();
      }
    ),

    evalCase(
      "arguments that don't fit the tool's schema come back as an error the model can read",
      async (t) => {
        const turn = await t.send(plan(call("read", { path: 42 })));
        t.check(turn.status, "run status").equals("succeeded").gate();
        t.calledTool("read").gate();
        t.check(endOf(callOf(turn, "read")), "how the call ended")
          .matches(ERROR)
          .gate();
        t.check(turn.text, "what the model was told").matches(PLAN_DONE).gate();
        t.check(turn.text, "what the model was told")
          .includes("Invalid input for tool read")
          .gate();
        t.check(await t.files({ chat: chatOf(t) }), "workspace files")
          .equals([])
          .gate();
      }
    ),

    evalCase(
      "a call to a tool the turn doesn't have comes back as an error, and the turn goes on (131)",
      async (t) => {
        const made = await t.send(
          plan(unofferedCall("frobnicate", { path: "notes.txt" }))
        );
        t.check(made.status, "run status").equals("succeeded").gate();
        t.calledTool("frobnicate", { path: "notes.txt" }).gate();
        t.check(endOf(callOf(made, "frobnicate")), "how the call ended")
          .matches(ERROR)
          .gate();
        t.check(made.text, "what the model was told").matches(PLAN_DONE).gate();
        t.check(made.text, "what the model was told")
          .includes("unavailable tool 'frobnicate'")
          .gate();

        // A tool the composer withheld is a tool the turn doesn't have.
        const withheld = await t.send(
          plan(unofferedCall("write", { content: "hi\n", path: "a.txt" })),
          { run: { sandbox: "off" } }
        );
        t.check(withheld.status, "run status with the file tools off")
          .equals("succeeded")
          .gate();
        t.check(endOf(callOf(withheld, "write")), "how the write ended")
          .matches(ERROR)
          .gate();
        t.check(withheld.text, "what the model was told")
          .includes("unavailable tool 'write'")
          .gate();
        t.check(await t.readFile("a.txt"), "a.txt")
          .equals(null)
          .gate();
      }
    ),

    evalCase(
      "skill tools (128): create and publish each wait for approval and land in the library; someone else's skill is a tool error",
      async (t) => {
        const name = "Eval standup notes";
        const api = t.api("ben");
        const mineNamed = async () =>
          (
            await api.library.list({
              kind: "skill",
              limit: 10,
              query: name,
              tab: "mine",
            })
          ).items;
        let turn = await t.send(
          plan(
            call("create_skill", {
              description: "Turns updates into standup notes.",
              instructions: "Write three bullets: done, doing, blocked.",
              name,
            }),
            call("publish_skill", {
              skillId: resultArg("skillId"),
              skillName: name,
            })
          ),
          { as: "ben" }
        );
        try {
          t.check(turn.status, "run status").equals("awaiting_approval").gate();
          t.check(
            turn.pending.map((each) => each.toolName),
            "what waits first"
          )
            .equals(["create_skill"])
            .gate();
          t.check(await mineNamed(), "Ben's skills before Approve")
            .equals([])
            .gate();

          turn = await t.approve({ as: "ben" });
          t.check(
            turn.pending.map((each) => each.toolName),
            "what waits next"
          )
            .equals(["publish_skill"])
            .gate();
          const [draft] = await mineNamed();
          t.check(draft?.latestVersionId ?? null, "published before Approve")
            .equals(null)
            .gate();

          turn = await t.approve({ as: "ben" });
          t.check(turn.status, "run status").equals("succeeded").gate();
          t.check(endOf(callOf(turn, "publish_skill")), "how publish ended")
            .equals("success")
            .gate();
          const [live] = await mineNamed();
          t.check(live?.latestVersionNumber ?? null, "the published version")
            .equals(1)
            .gate();

          // Dee can't see Ben's skill: her approved edit is refused with a
          // reason the model reads, and nothing changes.
          const dee = await t.send(
            plan(
              call("update_skill", {
                name: "Dee's now",
                skillId: live?.id ?? "",
              })
            ),
            { as: "dee", chat: await t.newChat({ as: "dee" }) }
          );
          t.check(dee.status, "Dee's run").equals("awaiting_approval").gate();
          const refused = await t.approve({ as: "dee" });
          t.check(
            endOf(callOf(refused, "update_skill")),
            "how Dee's edit ended"
          )
            .equals("tool-error")
            .gate();
          t.check(refused.text, "what the model was told")
            .includes("No skill with that id that the person can see")
            .gate();
          t.check((await mineNamed())[0]?.name ?? null, "the skill's name")
            .equals(name)
            .gate();
        } finally {
          for (const item of await mineNamed()) {
            // biome-ignore lint/performance/noAwaitInLoops: one skill, maybe two.
            await api.library.delete({ id: item.id });
          }
        }
      }
    ),

    // Live only: tool choice when the prompt doesn't name a tool.
    liveCase(
      "live: 'what did I write down?' looks in the workspace instead of guessing",
      async (t) => {
        await writeFile(
          t,
          "notes.md",
          "- buy oat milk\n- call the plumber on Tuesday\n"
        );
        const turn = await t.send("What did I write down in my notes?");
        t.check(turn.status, "run status").equals("succeeded").soft();
        t.notCalledTool("write").soft();
        t.notCalledTool("edit").soft();
        t.judge(
          "The assistant looked in the workspace (for example by reading notes.md) rather than guessing or saying it can't see files, and its answer reports what the notes say: oat milk and the plumber on Tuesday."
        );
      },
      { modelCalls: 3 }
    ),

    liveCase(
      "live: a question about something recent searches the web",
      async (t) => {
        const turn = await t.send(
          "Is there any news this week about the Bluebird open-source project? Check online."
        );
        t.check(turn.status, "run status").equals("succeeded").soft();
        t.notCalledTool("bash").soft();
        t.judge(
          "Asked for current information online, the assistant used web search (web_search) rather than answering from memory alone, and its answer reports only what the search results say."
        );
      },
      { modelCalls: 2 }
    ),
  ],
  name: "tools",
  proves:
    "Once a model picks a tool, the server does the right thing with it: write, bash, read, file_search, web_search and an instance MCP tool are offered on a plain chat (or withheld by the composer's switches and when there is nothing to search), the call is stored with the model's arguments, write and unattached MCP tools ask first while bash, read and the searches run, and the result reaches the model; a call the turn can't make (a tool it doesn't have, or arguments that don't fit) comes back to the model as an error and the turn goes on. Whether a model would pick that tool is scripted, not tested.",
});

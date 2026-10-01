import { call, plan, SHOW_SYSTEM } from "../src/mock";
import { defineSuite, evalCase } from "../src/suite";
import {
  callOf,
  chatOf,
  endOf,
  exec,
  messageOf,
  OUTSIDE,
  sandboxIdOf,
  writeFile,
} from "./support";

// Where the agent's file tools and the Files routes may reach (D7, 074):
// inside /work, by one rule. The mock asks for each path exactly as a case
// spells it, so every refusal here is the server's. The workspace is
// just-bash (an in-memory filesystem), which is what the deterministic
// server runs; the Docker provider has its own smoke test.

const ESCAPES = [
  "/etc/passwd",
  "../x.txt",
  "/work/../etc/passwd",
  "../../../../etc/shadow",
  "/work",
  "a/../../b.txt",
];

const NOT_TEXT = /not a UTF-8 text file/;
const CONTROL = /control characters/;
const OMITTED_BINARY =
  '<workspace-file path="blob.bin" omitted="true">The file isn\'t UTF-8 text';
const OMITTED_BIG =
  /<workspace-file path="big\.txt" omitted="true">[^<]*300000/;

const SYMLINKS =
  "Known gap (074 left it out of scope; the follow-up isn't built): the /work check is on the path's text, so a symlink inside /work that points outside is followed.";
const NUL =
  "Product bug found by this case: a NUL character in a tool call's arguments or in a tool's result fails the whole run with `internal` and stores an empty answer (Postgres can't store \\u0000 in JSON), instead of an error the model can read. One file with a NUL byte in the workspace is enough.";

export const files = defineSuite({
  cases: [
    evalCase(
      "read refuses every path outside /work, as an error the model can read",
      async (t) => {
        const turn = await t.send(
          plan(...ESCAPES.map((path) => call("read", { path })))
        );
        t.check(turn.status, "run status").equals("succeeded").gate();
        t.check(
          turn.toolCalls.map((made) => [
            (made.input as { readonly path?: unknown }).path,
            endOf(made),
            OUTSIDE.test(messageOf(made)),
          ]),
          "each read: path, how it ended, whether it says why"
        )
          .equals(ESCAPES.map((path) => [path, "tool-error", true]))
          .gate();
      }
    ),

    evalCase(
      "write and edit refuse every path outside /work, even when approved",
      async (t) => {
        let turn = await t.send(
          plan(
            // So the chat has a workspace to look into afterwards.
            call("bash", { command: "echo ready" }),
            ...ESCAPES.map((path) => call("write", { content: "x\n", path })),
            call("edit", { newString: "y", oldString: "x", path: "/etc/hosts" })
          )
        );
        while (turn.status === "awaiting_approval") {
          // biome-ignore lint/performance/noAwaitInLoops: one approval at a time, in order.
          turn = await t.approve();
        }
        t.check(turn.status, "run status").equals("succeeded").gate();
        t.check(
          turn.toolCalls.map((made) => [
            made.name,
            endOf(made),
            OUTSIDE.test(messageOf(made)),
          ]),
          "each change: tool, how it ended, whether it says why"
        )
          .equals([
            ["bash", "success", false],
            ...ESCAPES.map(() => ["write", "tool-error", true]),
            ["edit", "tool-error", true],
          ])
          .gate();
        t.check(await t.files(), "workspace files")
          .equals([])
          .gate();
        const looked = await exec(
          t,
          "ls /x.txt /b.txt /etc/passwd /etc/shadow 2>/dev/null; echo checked"
        );
        t.check(looked.stdout, "what is outside /work afterwards")
          .equals("checked\n")
          .gate();
      }
    ),

    evalCase(
      "the Files routes refuse the same paths with a 4xx, never a 5xx",
      async (t) => {
        await writeFile(t, "inside.txt", "inside\n");
        const conversationId = chatOf(t);
        const id = await sandboxIdOf(t);
        const api = t.api();
        const got: Record<string, readonly number[]> = {};
        for (const path of [...ESCAPES, "bad\nname.txt", "tab\there.txt"]) {
          // biome-ignore lint/performance/noAwaitInLoops: a handful of small requests, in order for a readable failure.
          got[path] = await Promise.all([
            t.statusOf(() =>
              api.sandbox.writeFile({
                content: "x",
                conversationId,
                encoding: "utf8",
                path,
              })
            ),
            t.statusOf(() => api.sandbox.deleteFile({ conversationId, path })),
          ]);
        }
        t.check(
          Object.values(got).every((pair) =>
            pair.every((status) => status >= 400 && status < 500)
          ),
          `writing and deleting outside /work were all 4xx (${JSON.stringify(got)})`
        )
          .equals(true)
          .gate();
        t.check(
          await t.statusOf(() =>
            api.sandbox.readFile({ id, path: "../x.txt" })
          ),
          "reading ../x.txt"
        )
          .equals(422)
          .gate();
        t.check(
          (await t.files()).map((file) => file.path),
          "workspace files"
        )
          .equals(["inside.txt"])
          .gate();
      }
    ),

    evalCase(
      "a control character in a path is refused by the file tools",
      async (t) => {
        const turn = await t.send(
          plan(
            call("read", { path: "bad\nname.txt" }),
            call("write", { content: "x\n", path: "tab\there.txt" })
          )
        );
        const done =
          turn.status === "awaiting_approval" ? await t.approve() : turn;
        t.check(done.status, "run status").equals("succeeded").gate();
        t.check(
          done.toolCalls.map((made) => [
            made.name,
            endOf(made),
            messageOf(made),
          ]),
          "each call"
        )
          .matches([
            ["read", "tool-error", CONTROL],
            ["write", "tool-error", CONTROL],
          ])
          .gate();
        t.check(await t.files(), "workspace files")
          .equals([])
          .gate();
      }
    ),

    evalCase(
      "NUL in a path: the tool refuses it and the run carries on",
      async (t) => {
        const turn = await t.send(plan(call("read", { path: "a\u0000b.txt" })));
        const gap = { expectedFailure: NUL };
        t.check(turn.status, "run status").equals("succeeded").gate(gap);
        t.check(endOf(callOf(turn, "read")), "how the read ended")
          .equals("tool-error")
          .gate(gap);
        // Whatever happened, the chat still works.
        const after = await t.send("still there?");
        t.check(after.text, "the next turn")
          .equals("Echo: still there?")
          .gate();
      }
    ),

    evalCase(
      "NUL in a file: reading it is a result, not a failed run",
      async (t) => {
        await writeFile(t, "nul.txt", "a\u0000b\n");
        const turn = await t.send(plan(call("read", { path: "nul.txt" })));
        const gap = { expectedFailure: NUL };
        t.check(turn.status, "run status").equals("succeeded").gate(gap);
        t.calledTool("read", { path: "nul.txt" }).gate(gap);
        const after = await t.send("still there?");
        t.check(after.text, "the next turn")
          .equals("Echo: still there?")
          .gate();
      }
    ),

    evalCase(
      "huge file: read is capped and says so, a range still works, and @file doesn't inline it",
      async (t) => {
        const line = `${"abcdefghi".repeat(11)}\n`;
        await writeFile(t, "big.txt", line.repeat(3000));
        const turn = await t.send(
          plan(
            call("read", { path: "big.txt" }),
            call("read", { limit: 2, offset: 2999, path: "big.txt" })
          )
        );
        t.check(turn.status, "run status").equals("succeeded").gate();
        const whole = callOf(turn, "read", 0)?.output as
          | { readonly content?: string }
          | undefined;
        t.check(callOf(turn, "read", 0)?.output, "the whole file")
          .matches({ status: "read", totalLines: 3001, truncated: true })
          .gate();
        t.check(whole?.content?.length, "characters returned")
          .equals(200_000)
          .gate();
        t.check(callOf(turn, "read", 1)?.output, "two lines near the end")
          .matches({
            content: line.repeat(2).trimEnd(),
            status: "read",
            truncated: false,
          })
          .gate();

        const mentioned = await t.send(SHOW_SYSTEM, { mentions: ["big.txt"] });
        t.check(mentioned.text, "the instructions").matches(OMITTED_BIG).gate();
        t.check(mentioned.text.length < 10_000, "the instructions stayed small")
          .equals(true)
          .gate();
      }
    ),

    evalCase(
      "huge write: the Files route refuses more than 5 MiB with a 400",
      async (t) => {
        const conversationId = await t.newChat();
        t.check(
          await t.statusOf(() =>
            t.api().sandbox.writeFile({
              content: "a".repeat(5 * 1024 * 1024 + 1),
              conversationId,
              encoding: "utf8",
              path: "huge.txt",
            })
          ),
          "writing 5 MiB + 1 byte"
        )
          .equals(400)
          .gate();
        t.check(await t.files(), "workspace files")
          .equals([])
          .gate();
      }
    ),

    evalCase(
      "huge output: a command's output is capped and says so",
      async (t) => {
        // 300 000 characters, printed twice: past the 256 KiB a result keeps.
        await writeFile(
          t,
          "big.txt",
          `${"abcdefghi".repeat(11)}\n`.repeat(3000)
        );
        const turn = await t.send(
          plan(call("bash", { command: "cat big.txt big.txt" }))
        );
        t.check(turn.status, "run status").equals("succeeded").gate();
        const output = callOf(turn, "bash")?.output as
          | { readonly stdout?: string; readonly truncated?: boolean }
          | undefined;
        t.check(output?.truncated, "truncated").equals(true).gate();
        t.check(
          (output?.stdout?.length ?? 0) > 100_000 &&
            (output?.stdout?.length ?? 0) < 300_000,
          `the output kept is near the 256 KiB cap (${output?.stdout?.length} characters)`
        )
          .equals(true)
          .gate();
        t.check(output?.stdout ?? "", "the output")
          .includes("characters omitted")
          .gate();
      }
    ),

    evalCase(
      "binary file: read and @file say it isn't text, and the Files route returns it intact",
      async (t) => {
        const bytes = Buffer.from([0xff, 0xfe, 0xfd, 0x80, 0x01, 0x02]);
        await writeFile(t, "blob.bin", bytes.toString("base64"), {
          base64: true,
        });
        const turn = await t.send(plan(call("read", { path: "blob.bin" })));
        t.check(turn.status, "run status").equals("succeeded").gate();
        t.check(endOf(callOf(turn, "read")), "how the read ended")
          .equals("tool-error")
          .gate();
        t.check(messageOf(callOf(turn, "read")), "what it said")
          .matches(NOT_TEXT)
          .gate();

        const mentioned = await t.send(SHOW_SYSTEM, { mentions: ["blob.bin"] });
        t.check(mentioned.text, "the instructions")
          .includes(OMITTED_BINARY)
          .gate();

        const stored = await t.api().sandbox.readFile({
          id: await sandboxIdOf(t),
          path: "blob.bin",
        });
        t.check(
          [stored.encoding, stored.content, stored.size],
          "the file as the route returns it"
        )
          .equals(["base64", bytes.toString("base64"), bytes.length])
          .gate();
      }
    ),

    evalCase(
      "symlink escape: read, @file and the Files route don't follow a link out of /work",
      async (t) => {
        const setup = await t.send(
          plan(
            call("bash", {
              command:
                "mkdir -p /tmp/outside && echo TOP-SECRET > /tmp/outside/secret.txt && ln -s /tmp/outside/secret.txt /work/leak.txt && echo inside > /work/ok.txt",
            }),
            call("read", { path: "leak.txt" }),
            call("read", { path: "ok.txt" })
          )
        );
        t.check(setup.status, "run status").equals("succeeded").gate();
        // The control: an ordinary file beside the link reads fine.
        t.check(callOf(setup, "read", 1)?.output, "reading ok.txt")
          .matches({ content: "inside\n", status: "read" })
          .gate();

        const gap = { expectedFailure: SYMLINKS };
        t.check(
          JSON.stringify(callOf(setup, "read", 0)?.output),
          "what read returned for the link"
        )
          .not.includes("TOP-SECRET")
          .gate(gap);
        const mentioned = await t.send(SHOW_SYSTEM, { mentions: ["leak.txt"] });
        t.check(mentioned.text, "the instructions after @leak.txt")
          .not.includes("TOP-SECRET")
          .gate(gap);
        t.check(
          await t.readFile("leak.txt").catch(() => null),
          "what the Files route returns for the link"
        )
          .equals(null)
          .gate(gap);
      }
    ),

    evalCase("@file only reads inside /work", async (t) => {
      await t.send(
        plan(
          call("bash", {
            command:
              "mkdir -p /tmp/outside && echo TOP-SECRET > /tmp/outside/secret.txt",
          })
        )
      );
      const mentioned = await t.send(SHOW_SYSTEM, {
        mentions: ["/tmp/outside/secret.txt", "../tmp/outside/secret.txt"],
      });
      t.check(mentioned.status, "run status").equals("succeeded").gate();
      t.check(mentioned.text, "the instructions")
        .not.includes("TOP-SECRET")
        .gate({
          expectedFailure:
            "Known gap (noted as left in 074's resolution): @file mentions resolve with the loose sandbox path rule, not the /work one, so a mention of an absolute path outside /work is read into the instructions.",
        });
    }),

    evalCase(
      "symlink escape: a write through a linked directory is refused, and the workspace keeps working",
      async (t) => {
        await t.send(
          plan(
            call("bash", {
              command:
                "mkdir -p /tmp/outside && ln -s /tmp/outside /work/out && echo ready",
            })
          )
        );
        const asked = await t.send(
          plan(call("write", { content: "escaped\n", path: "out/x.txt" }))
        );
        const written =
          asked.status === "awaiting_approval" ? await t.approve() : asked;
        const gap = {
          expectedFailure: `${SYMLINKS} Product bug found by this case: instead of a tool error, the write fails the run with \`internal\` (ENOENT on lstat '/work/out/x.txt'; that raw error is what the model is shown), and every later bash call in that chat fails the same way: the workspace is unusable from then on.`,
        };
        t.check(written.status, "run status").equals("succeeded").gate(gap);
        t.check(endOf(callOf(written, "write")), "how the write ended")
          .equals("tool-error")
          .gate(gap);
        const after = await t.send(
          plan(call("bash", { command: "echo still-works" }))
        );
        t.check(after.status, "a command afterwards")
          .equals("succeeded")
          .gate(gap);
      }
    ),

    evalCase(
      "symlink escape: the Files route refuses a write through a linked directory with a 4xx",
      async (t) => {
        await t.send(
          plan(
            call("bash", {
              command:
                "mkdir -p /tmp/outside && ln -s /tmp/outside /work/out && echo ready",
            })
          )
        );
        const id = await sandboxIdOf(t);
        const gap = {
          expectedFailure: `${SYMLINKS} Product bug found by this case: \`sandbox.writeFile\` through the link answers 500, and \`sandbox.exec\` on that workspace answers 500 from then on.`,
        };
        t.check(
          await t.statusOf(() =>
            t.api().sandbox.writeFile({
              content: "escaped\n",
              conversationId: chatOf(t),
              encoding: "utf8",
              path: "out/y.txt",
            })
          ),
          "writing out/y.txt"
        )
          .equals(422)
          .gate(gap);
        t.check(
          await t.statusOf(() =>
            t.api().sandbox.exec({ command: "echo ok", id })
          ),
          "running a command afterwards"
        )
          .equals(200)
          .gate(gap);
      }
    ),
  ],
  name: "files",
  proves:
    "The /work boundary holds for paths as text: read, write and edit return an error the model can read for /etc/passwd, ../x, /work/../etc and the workspace root, even when the change was approved, and the Files routes answer 4xx; control characters in paths are refused; big files, big output and big writes are capped and say so; binary files are reported as such and round-trip intact. It does not hold for symlinks, NUL, or @file paths: six cases record those as expected failures, three of them product bugs this suite found.",
});

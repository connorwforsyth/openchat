import { SHOW_SYSTEM } from "../src/mock";
import { defineSuite, evalCase, liveCase } from "../src/suite";
import { callOf, uploadPdf, writeFile } from "./support";

// Grounding is mostly a judged question (are the claims supported?). The
// deterministic half is about delivery: the fixture's facts and the file's
// name reach the model, from the index, the workspace or the memory file.
// The mock repeats what it was given, so "the answer includes the fact"
// means "the server put the fact in front of the model".

const REPORT = [
  "Quarterly report for the platform team.",
  "The heliotrope budget grew by twelve percent this quarter.",
];
const FACT = "heliotrope budget grew by twelve percent";

export const grounding = defineSuite({
  cases: [
    evalCase(
      "attached PDF: the passage and the file's name reach the model, and the answer cites the file",
      async (t) => {
        const file = await uploadPdf(t, "quarterly-report.pdf", REPORT);
        t.check(file.status, "the upload's indexing")
          .matches({ embeddingModel: "mock:embed", state: "ready" })
          .gate();

        const turn = await t.send(
          "[search:heliotrope budget] What happened to it?"
        );
        t.calledTool("file_search", { query: "heliotrope budget" }).gate();
        t.check(turn.status, "run status").equals("succeeded").gate();
        t.check(callOf(turn, "file_search")?.output, "the search result")
          .matches({
            hits: [
              {
                filename: "quarterly-report.pdf",
                page: 1,
                text: (text) => typeof text === "string" && text.includes(FACT),
              },
            ],
          })
          .gate();
        t.check(turn.text, "the answer").includes(FACT).gate();
        t.check(turn.text, "the answer")
          .includes("quarterly-report.pdf")
          .gate();

        // Stored as a citation on the answer, not only said in its text.
        const answer = turn.assistantMessageId
          ? await t.api().messages.get({ id: turn.assistantMessageId })
          : null;
        const cited = (answer?.parts ?? []).flatMap((part) =>
          part.type === "source" && part.source.kind === "file"
            ? [{ fileId: part.source.fileId, filename: part.source.filename }]
            : []
        );
        t.check(cited, "the answer's citations")
          .equals([{ fileId: file.id, filename: "quarterly-report.pdf" }])
          .gate();

        t.judge(
          "Every claim in the answer is supported by the attached report."
        ).soft();
      },
      { timeoutMs: 90_000 }
    ),

    evalCase(
      "@file: the mentioned file is in front of the model, as it is now",
      async (t) => {
        await writeFile(t, "notes.md", "The launch code name is BLUEBIRD.\n");
        const first = await t.send("What is the code name?", {
          mentions: ["notes.md"],
        });
        t.check(first.status, "run status").equals("succeeded").gate();
        t.notCalledTool().gate();
        t.check(first.text, "the answer")
          .includes("[notes.md: The launch code name is BLUEBIRD.]")
          .gate();

        // The person edits the file; the next mention reads it again.
        await writeFile(t, "notes.md", "The launch code name is KESTREL.\n");
        const second = await t.send("And now?", { mentions: ["notes.md"] });
        t.check(second.text, "the answer after the edit")
          .includes("[notes.md: The launch code name is KESTREL.]")
          .gate();
        t.check(second.text, "the answer after the edit")
          .not.includes("BLUEBIRD")
          .gate();
      }
    ),

    evalCase(
      "@file: a file that isn't there is a note to the model, not a failed turn",
      async (t) => {
        await writeFile(t, "present.md", "here\n");
        const turn = await t.send(SHOW_SYSTEM, {
          mentions: ["missing.md", "present.md"],
        });
        t.check(turn.status, "run status").equals("succeeded").gate();
        t.check(turn.text, "the instructions")
          .includes(
            '<workspace-file path="missing.md" omitted="true">No such file in the workspace.</workspace-file>'
          )
          .gate();
        t.check(turn.text, "the instructions")
          .includes('<workspace-file path="present.md">\nhere\n')
          .gate();
      }
    ),

    evalCase(
      "memory: what was remembered is in the instructions of the next private chat",
      async (t) => {
        const api = t.api("ben");
        const before = await api.memory.get();
        try {
          const saved = await t.send("remember that I prefer pnpm over npm", {
            as: "ben",
          });
          t.calledTool("update_memory").gate();
          t.check(saved.status, "run status").equals("succeeded").gate();
          t.check((await api.memory.get()).content, "the memory file")
            .includes("I prefer pnpm over npm")
            .gate();

          await t.newChat({ as: "ben" });
          const recalled = await t.send(SHOW_SYSTEM, { as: "ben" });
          t.check(recalled.text, "the next chat's instructions")
            .includes("<memory>\n- I prefer pnpm over npm\n</memory>")
            .gate();
        } finally {
          // Memory is per user, not per chat: leave it as it was found.
          const now = await api.memory.get();
          await api.memory.update({
            baseVersionId: now.versionId,
            content: before.content,
          });
        }
      }
    ),

    evalCase(
      "picked skill: its SKILL.md is in the instructions, kept with the message, and only a usable one is taken",
      async (t) => {
        const marker = "MARKER-EVAL-SKILL";
        const skillMd = (body: string) =>
          `---\nname: changelog\ndescription: Writes a changelog.\n---\n\n${body}\n`;
        const api = t.api("ben");
        const mine = await api.library.create({
          definition: {
            files: [],
            kind: "skill",
            skillMd: skillMd(`Group changes by area. ${marker}`),
          },
          name: "Changelog",
        });
        const theirs = await t.api("dee").library.create({
          definition: { files: [], kind: "skill", skillMd: skillMd("Nope.") },
          name: "Dee's skill",
        });
        try {
          await api.library.publishVersion({ id: mine.id });
          await t.api("dee").library.publishVersion({ id: theirs.id });

          const turn = await t.send(SHOW_SYSTEM, {
            as: "ben",
            skills: [{ id: mine.id }],
          });
          t.check(turn.status, "run status").equals("succeeded").gate();
          t.check(turn.text, "the instructions")
            .includes('The user picked the skill "Changelog"')
            .gate();
          t.check(turn.text, "the instructions").includes(marker).gate();
          // The frontmatter is the library's, not the model's.
          t.check(turn.text, "the instructions")
            .not.includes("name: changelog")
            .gate();
          const sent = await api.messages.get({ id: turn.userMessageId });
          t.check(
            sent.parts.find((part) => part.type === "data"),
            "the message's record of its skills"
          )
            .matches({
              data: { skills: [{ id: mine.id, name: "Changelog" }] },
              name: "skills",
            })
            .gate();

          // Another person's private skill: refused, and nothing runs.
          t.check(
            await t.statusOf(() =>
              t.send(SHOW_SYSTEM, { as: "ben", skills: [{ id: theirs.id }] })
            ),
            "picking someone else's private skill"
          )
            .equals(422)
            .gate();
        } finally {
          await api.library.delete({ id: mine.id });
          await t.api("dee").library.delete({ id: theirs.id });
        }
      }
    ),

    // Live only: are the claims supported by what the model was given?
    liveCase(
      "live: an @file answer claims nothing the file doesn't say",
      async (t) => {
        const launch = [
          "Project Bluebird launches on 14 March.",
          "The launch owner is Priya.",
          "The budget has not been approved yet.",
        ].join("\n");
        await writeFile(t, "launch.md", `${launch}\n`);
        const turn = await t.send(
          "When does Bluebird launch, who owns it, and what is the budget?",
          { mentions: ["launch.md"] }
        );
        t.check(turn.status, "run status").equals("succeeded").soft();
        t.judge(
          "No claim is unsupported by the context: the reply gives 14 March and Priya, and says the budget isn't approved or isn't stated, without inventing a figure or any other detail.",
          { context: `launch.md:\n${launch}` }
        );
      }
    ),
  ],
  name: "grounding",
  proves:
    "What an answer should be grounded in is delivered to the model: an attached PDF is parsed, indexed and found by file_search with its file name and page, and the answer stores a citation to it; an @file mention puts the file's current content in the instructions (and a missing one is a note, not a failure); the memory file is in the next private chat's instructions; a skill picked for a message puts its SKILL.md in the instructions, is kept with the message, and is refused unless the sender may use it. Whether a model then sticks to it is the judged half.",
});

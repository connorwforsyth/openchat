import { newId } from "@workspace/shared/ids";
import { ok } from "@workspace/shared/result";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  type ArtifactStore,
  createArtifact,
  createArtifactInputSchema,
} from "../../src/tools/artifacts";
import recorded from "./recorded-live.json" with { type: "json" };

// Every failure the live artifact eval found (`packages/evals/src/artifacts`,
// recorded with its `record-fixtures.ts`), replayed through
// `create_artifact` with no model: what the tool says today to the exact
// calls a real model made. The snapshot pins it, so a change to a kind's
// input shape or checks shows here as a diff against real model output.
// A change that should flip a fixture (a check that now catches what only
// failed in the renderer, or a shape that now accepts what the model meant)
// updates the snapshot in the same commit, with `vitest -u`, and says so.

const fixtureSchema = z.object({
  calls: z.array(z.object({ input: z.unknown(), name: z.string() })),
  category: z.string(),
  detail: z.string(),
  id: z.string(),
  kind: z.string(),
  model: z.string(),
  prompt: z.string(),
  text: z.string(),
});

const fixtures = z.array(fixtureSchema).parse(recorded);

const acceptingStore: ArtifactStore = {
  list: () => Promise.resolve([]),
  read: () => Promise.resolve(null),
  save: (input) =>
    Promise.resolve(
      ok({
        artifactId: newId("artifact"),
        kind: input.kind,
        title: input.title,
        version: 1,
        versionId: newId("artifactVersion"),
      })
    ),
};

/** What `create_artifact` answers one recorded call with, today. */
const replay = async (input: unknown): Promise<string> => {
  const parsed = createArtifactInputSchema.safeParse(input);
  if (!parsed.success) {
    return `input refused: ${parsed.error.issues
      .map((issue) => `${issue.path.join(".")} ${issue.message}`)
      .join("; ")}`;
  }
  const output = await createArtifact(acceptingStore, parsed.data);
  return output.status === "invalid"
    ? `invalid: ${output.problems.join("; ")}`
    : output.status;
};

describe("recorded live failures, replayed offline", () => {
  it("has fixtures", () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  // Failures with no artifact call (work written to a workspace file, a
  // plain answer) have nothing to replay; they stay in the file as prompts.
  for (const fixture of fixtures.filter((each) =>
    each.calls.some((call) => call.name === "create_artifact")
  )) {
    it(`${fixture.kind} ${fixture.id} (${fixture.category} on ${fixture.model})`, async () => {
      const answers: string[] = [];
      for (const call of fixture.calls.filter(
        (each) => each.name === "create_artifact"
      )) {
        // biome-ignore lint/performance/noAwaitInLoops: the calls were made in order.
        answers.push(await replay(call.input));
      }
      expect(answers).toMatchSnapshot();
    });
  }
});

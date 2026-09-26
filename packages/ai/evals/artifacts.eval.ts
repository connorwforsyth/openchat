import type { ArtifactKind } from "@workspace/contract/schemas/message-parts";
import { evalite } from "evalite";

import {
  ARTIFACT_CASES,
  type ArtifactCase,
  RECORDED_REPLIES,
} from "./artifacts/fixtures";
import { type ParsedReply, parseArtifacts } from "./artifacts/format";
import { passes, sameJson } from "./core/scorers";

// Dev eval (D21): replies to the artifacts prompt carry well-formed
// artifacts of the kinds asked for, and none when none were. Runs on
// recorded replies, so it needs no network and no keys.

evalite<ArtifactCase["input"], ParsedReply, readonly ArtifactKind[]>(
  "Artifacts prompt yields well-formed artifacts",
  {
    data: ARTIFACT_CASES.map(({ expected, input }) => ({ expected, input })),
    scorers: [
      passes("well-formed", (output) =>
        output.problems.length === 0 ? true : output.problems.join("; ")
      ),
      passes("expected kinds", (output, expected) => {
        const kinds = output.artifacts.map((artifact) => artifact.kind);
        return sameJson(kinds, expected)
          ? true
          : `got [${kinds.join(", ")}], wanted [${expected?.join(", ")}]`;
      }),
    ],
    task: (input) => {
      const reply = RECORDED_REPLIES[input.id];
      if (reply === undefined) {
        throw new Error(`no recorded reply for "${input.id}"`);
      }
      return parseArtifacts(reply);
    },
  }
);

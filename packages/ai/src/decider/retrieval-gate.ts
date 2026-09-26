import type { DeciderState } from "@workspace/contract/schemas/decider";
import type { RunOptions } from "@workspace/contract/schemas/runs";

import type {
  DecideOptions,
  Decider,
  DeciderQuestionInput,
} from "../ports/decider";
import { probabilityOfTrue } from "./questions";

// Retrieval gating (D15 use 4, M1): does this turn need file search, web
// search or a memory lookup? The gate only ever *removes* retrieval tools
// from what the rules allowed; it can't add one. `webSearch: off` always
// wins, `on` skips the question. With no opinion, the tools stay and the
// model decides for itself, as it would without a Decider.

export const WEB_SEARCH_TOOL = "web_search";
export const FILE_SEARCH_TOOL = "file_search";

const QUESTIONS = {
  needsFiles: {
    id: "needsFiles",
    prompt:
      "Does answering this turn need to search the user's uploaded files or knowledge base?",
    type: "boolean",
  },
  needsMemory: {
    id: "needsMemory",
    prompt:
      "Would facts the assistant remembers about the user help answer this turn?",
    type: "boolean",
  },
  needsWeb: {
    id: "needsWeb",
    prompt: "Does answering this turn need current information from the web?",
    type: "boolean",
  },
} as const satisfies Record<string, DeciderQuestionInput>;

export interface RetrievalGateInput {
  /** Tool names the rules allowed for this turn. */
  readonly activeTools: readonly string[];
  readonly context?: DecideOptions["context"];
  readonly decider: Decider;
  /** Whether a memory lookup is possible at all (feature on, chat not shared). */
  readonly memory: boolean;
  readonly options: Pick<RunOptions, "webSearch">;
  readonly signal?: AbortSignal;
  readonly state: DeciderState;
  /** `decider.thresholds.needsRetrieval`. */
  readonly threshold: number;
  readonly toolNames?: { readonly files: string; readonly web: string };
}

export interface RetrievalGate {
  /** Always a subset of the input's `activeTools`. */
  readonly activeTools: readonly string[];
  readonly decided: boolean;
  readonly needs: {
    readonly files: boolean;
    readonly memory: boolean;
    readonly web: boolean;
  };
}

export const gateRetrieval = async ({
  activeTools,
  context,
  decider,
  memory,
  options,
  signal,
  state,
  threshold,
  toolNames = { files: FILE_SEARCH_TOOL, web: WEB_SEARCH_TOOL },
}: RetrievalGateInput): Promise<RetrievalGate> => {
  const webAllowed =
    activeTools.includes(toolNames.web) && options.webSearch !== "off";
  const filesAllowed = activeTools.includes(toolNames.files);
  const ruled = activeTools.filter(
    (name) => name !== toolNames.web || webAllowed
  );

  const questions: DeciderQuestionInput[] = [
    ...(webAllowed && options.webSearch === "auto" ? [QUESTIONS.needsWeb] : []),
    ...(filesAllowed ? [QUESTIONS.needsFiles] : []),
    ...(memory ? [QUESTIONS.needsMemory] : []),
  ];
  const noOpinion: RetrievalGate = {
    activeTools: ruled,
    decided: false,
    needs: { files: filesAllowed, memory, web: webAllowed },
  };
  if (questions.length === 0) {
    return noOpinion;
  }

  const decided = await decider.decide(state, questions, {
    context,
    purpose: "retrieval-gate",
    signal,
  });
  if (!decided.ok) {
    return noOpinion;
  }
  const answers = decided.value as Readonly<
    Record<string, Parameters<typeof probabilityOfTrue>[0] | undefined>
  >;
  const yes = (id: string, allowed: boolean): boolean => {
    const answer = answers[id];
    // Asked-about and allowed: the Decider decides. Not asked: the rules do.
    return allowed && (answer ? probabilityOfTrue(answer) >= threshold : true);
  };
  const needs = {
    files: yes("needsFiles", filesAllowed),
    memory: yes("needsMemory", memory),
    web: yes("needsWeb", webAllowed),
  };
  return {
    activeTools: ruled.filter(
      (name) =>
        (name !== toolNames.web || needs.web) &&
        (name !== toolNames.files || needs.files)
    ),
    decided: true,
    needs,
  };
};

import type * as Lazy from "../conversation/lazy";
import { ReasoningPart } from "../conversation/reasoning-part";
import { TestDiffView } from "./diff-view";

// `conversation/lazy` without the laziness, for unit tests (ticket 037):
//
//   vi.mock("../conversation/lazy", () => import("../testing/sync-lazy"));
//
// A lazy chunk resolves whenever the runner gets to it, and the conversation
// re-anchors its scroll when it does, so tests either waited on it or raced
// it. These render in the first commit. The typed exports keep the stand-ins
// in step with the real module.

export const LazyDiffView: typeof Lazy.LazyDiffView = TestDiffView;
export const LazyReasoning: typeof Lazy.LazyReasoning = ReasoningPart;

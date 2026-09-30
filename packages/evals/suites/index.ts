import type { Suite } from "../src/suite";
import { approvals } from "./approvals";
import { baseline } from "./baseline";
import { files } from "./files";
import { grounding } from "./grounding";
import { injection } from "./injection";
import { isolation } from "./isolation";
import { multiTurn } from "./multi-turn";
import { tools } from "./tools";

export const suites: readonly Suite[] = [
  baseline,
  tools,
  grounding,
  multiTurn,
  injection,
  isolation,
  approvals,
  files,
];

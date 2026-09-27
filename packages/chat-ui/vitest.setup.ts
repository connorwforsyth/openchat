import { configure } from "@testing-library/react";
import { vi } from "vitest";

// Loaded CI runners render several times slower than a laptop, so async
// queries (findBy*, waitFor) get 5 s instead of 1 s (ticket 035).
configure({ asyncUtilTimeout: 5000 });

// Component tests never start code-ui's Shiki worker pool (CodeUiProvider):
// spinning up workers that each load Shiki is exactly the kind of wait that
// times tests out on a busy runner (ticket 037). Without a pool, @pierre/diffs
// highlights on the main thread, so nothing here needs a Worker; fail loudly
// if something starts one rather than hang.
function refuseWorker(): never {
  throw new Error(
    "Tests must not start web workers (the Shiki pool); render without CodeUiProvider."
  );
}
vi.stubGlobal("Worker", refuseWorker);

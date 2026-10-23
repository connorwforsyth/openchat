import { RUNNER_UNAVAILABLE } from "@workspace/sandbox/runner/unavailable";

// What `bun dev` does about the sandbox runner. Previews need the runner in
// Docker (it joins each sandbox's network), so it always runs from compose's
// `sandbox` profile, never on the host. Pure: the facts in, one decision out;
// `scripts/dev.ts` is the shell.

export interface DevFacts {
  /** `docker info` answered. */
  readonly docker: boolean;
  /** `SANDBOX_RUNNER_PORT`, or unset. */
  readonly port: string | undefined;
  /** `SANDBOX_RUNNER_TOKEN`, or unset: without it the runner refuses every call. */
  readonly token: string | undefined;
}

export type DevPlan =
  | { readonly kind: "skip"; readonly line: string }
  | {
      readonly args: readonly string[];
      readonly done: string;
      readonly kind: "start";
    };

const fix = (reason: keyof typeof RUNNER_UNAVAILABLE) =>
  RUNNER_UNAVAILABLE[reason].command;

export const planDev = ({ docker, port, token }: DevFacts): DevPlan => {
  if (!token) {
    return {
      kind: "skip",
      line: `sandbox-runner: not started, SANDBOX_RUNNER_TOKEN is empty (run code uses just-bash). Set it up with: ${fix("not_configured")}`,
    };
  }
  if (!docker) {
    return {
      kind: "skip",
      line: `sandbox-runner: not started, Docker isn't running (run code and Dot computers are off). Start Docker, then run: ${fix("runner_unreachable")}`,
    };
  }
  return {
    // Builds the image only when it's missing; `--build` after changing the runner.
    args: [
      "compose",
      "--profile",
      "sandbox",
      "up",
      "-d",
      "--wait",
      "sandbox-runner",
    ],
    done: `sandbox-runner: up on http://localhost:${port || "7070"} (rebuild after changing it: ${fix("runner_unreachable")} --build)`,
    kind: "start",
  };
};

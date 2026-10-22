import { z } from "zod";

import type { SandboxError } from "../ports/sandbox";

// Why Docker sandboxes (and a Dot's computer) can't run, and the command
// that fixes each. One table: the docker client and the runner pick a
// reason where they see the failure (no token, connection refused, 401, the
// runner's own answer), the model and the log get `runnerUnavailableText`,
// and the UI renders the reason in the reader's language with the command.
// The frozen `SandboxError` carries only a message, so the reason travels as
// this table's exact text and `runnerUnavailableOf` reads it back.

export const runnerUnavailableReasonSchema = z.enum([
  "not_configured",
  "runner_unreachable",
  "runner_token_missing",
  "token_rejected",
  "docker_unavailable",
  "desktop_image_missing",
  "runner_error",
]);
export type RunnerUnavailableReason = z.infer<
  typeof runnerUnavailableReasonSchema
>;

export interface RunnerUnavailable {
  /** A shell command, run from the repo root, that fixes it. */
  readonly command: string;
  /** English, for the model and the log; the UI translates by `reason`. */
  readonly message: string;
  readonly reason: RunnerUnavailableReason;
}

const START_RUNNER = "docker compose --profile sandbox up -d sandbox-runner";
const RECREATE_RUNNER = `${START_RUNNER} --force-recreate`;

export const RUNNER_UNAVAILABLE: Readonly<
  Record<RunnerUnavailableReason, Omit<RunnerUnavailable, "reason">>
> = {
  desktop_image_missing: {
    command:
      "docker compose --profile sandbox-desktop-build build sandbox-desktop",
    message: "The computer's desktop image isn't built on this Docker host.",
  },
  docker_unavailable: {
    command: START_RUNNER,
    message:
      "The sandbox runner is up but can't reach Docker. Start Docker, then start the runner's services.",
  },
  not_configured: {
    command: "bun run setup",
    message:
      "Docker sandboxes aren't configured: set SANDBOX_RUNNER_TOKEN in .env and sandbox.docker in app.config.yaml.",
  },
  runner_error: {
    command: "docker compose --profile sandbox logs sandbox-runner",
    message: "The sandbox runner answered with an error; its log says why.",
  },
  runner_token_missing: {
    command: RECREATE_RUNNER,
    message:
      "The sandbox runner has no SANDBOX_RUNNER_TOKEN, so it refuses every call. Set it in .env, then recreate the runner.",
  },
  runner_unreachable: {
    command: START_RUNNER,
    message: "The sandbox runner isn't running.",
  },
  token_rejected: {
    command: RECREATE_RUNNER,
    message:
      "The sandbox runner rejected the app's SANDBOX_RUNNER_TOKEN: they differ. Use one value in .env, then recreate the runner.",
  },
};

export const runnerUnavailable = (
  reason: RunnerUnavailableReason
): RunnerUnavailable => ({ reason, ...RUNNER_UNAVAILABLE[reason] });

/** The reason and its fix in one line, as the model and the log see it. */
export const runnerUnavailableText = (reason: RunnerUnavailableReason) =>
  `${RUNNER_UNAVAILABLE[reason].message} Fix: ${RUNNER_UNAVAILABLE[reason].command}`;

export const runnerUnavailableError = (
  reason: RunnerUnavailableReason
): SandboxError => ({
  message: runnerUnavailableText(reason),
  type: "unavailable",
});

const BY_TEXT: ReadonlyMap<string, RunnerUnavailableReason> = new Map(
  runnerUnavailableReasonSchema.options.map((reason) => [
    runnerUnavailableText(reason),
    reason,
  ])
);

/**
 * The reason behind a message, if it is one of this table's: the whole
 * message, or its end (callers prefix it, as in "The workspace is
 * unavailable: …"). `null` for anything else.
 */
export const runnerUnavailableOf = (
  message: string
): RunnerUnavailable | null => {
  for (const [text, reason] of BY_TEXT) {
    if (message.endsWith(text)) {
      return runnerUnavailable(reason);
    }
  }
  return null;
};

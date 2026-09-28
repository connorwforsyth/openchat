import { randomBytes } from "node:crypto";
import { join } from "node:path";

import { cancel, intro, log, outro } from "@clack/prompts";

import { clackPrompter } from "./clack";
import { formatChecks, hasFailures, runDoctor } from "./doctor";
import {
  nodeFiles,
  nodeHttpGet,
  nodePortInUse,
  nodeRunner,
} from "./node-system";
import { readCurrentFiles, runSetup } from "./setup";
import { planUp, runUp } from "./up";

// The imperative shell: `bun run setup [up|doctor]` from the repo root.
// Wires the real ports into the pure commands and turns results into exit
// codes. A throw here is a bug; expected failures come back as values.

const root = join(import.meta.dirname, "..", "..", "..");
const files = nodeFiles(root);
const runner = nodeRunner(root);

const USAGE = `Usage: bun run setup [command]

  (none)   ask how to run it and write .env, app.config.yaml and, for Docker,
           docker-compose.override.yml (existing files are edited, with your
           current values as the defaults; nothing is overwritten unasked)
  up       build and start it (Docker), or start its services and bun dev (local)
  doctor   check Docker, ports, config, health, the sandbox runner and models`;

const NOT_A_CHECKOUT =
  "Can't find .env.example and app.config.example.yaml; run this from a checkout of the repo.";

const setup = async (): Promise<number> => {
  if (!process.stdin.isTTY) {
    log.error("The setup wizard needs an interactive terminal.");
    return 1;
  }
  intro("Setup");
  const result = await runSetup({
    files,
    prompter: clackPrompter,
    random: () => randomBytes(32).toString("hex"),
  });
  if (result.ok) {
    outro("Done.");
    return 0;
  }
  switch (result.error.type) {
    case "cancelled":
      cancel("Cancelled; nothing was written.");
      return 1;
    case "invalid-config":
      // Already explained by the wizard.
      return 1;
    case "not-a-checkout":
      log.error(NOT_A_CHECKOUT);
      return 1;
    default:
      return result.error satisfies never;
  }
};

const up = async (): Promise<number> => {
  const current = await readCurrentFiles(files);
  if (!current.ok) {
    log.error(NOT_A_CHECKOUT);
    return 1;
  }
  if (current.value.config === undefined) {
    log.warn(
      "No app.config.yaml yet: starting on defaults. `bun run setup` writes one."
    );
  }
  const result = await runUp(planUp(current.value, root), {
    print: (message) => log.step(message),
    runner,
  });
  if (result.ok) {
    log.success(`Running on ${result.value}`);
    return 0;
  }
  switch (result.error.type) {
    case "no-docker":
      log.error(
        "Docker isn't answering. Start Docker Desktop (or the daemon), then run this again."
      );
      return 1;
    case "failed":
      log.error(
        `\`${result.error.command}\` failed; its output is above. \`bun run setup doctor\` can help.`
      );
      return 1;
    default:
      return result.error satisfies never;
  }
};

const doctor = async (): Promise<number> => {
  const current = await readCurrentFiles(files);
  if (!current.ok) {
    log.error(NOT_A_CHECKOUT);
    return 1;
  }
  const checks = await runDoctor(current.value, {
    http: nodeHttpGet,
    portInUse: nodePortInUse,
    runner,
  });
  log.message(formatChecks(checks));
  return hasFailures(checks) ? 1 : 0;
};

const commands: Record<string, () => Promise<number>> = {
  doctor,
  setup,
  up,
};

const [name = "setup", ...rest] = process.argv.slice(2);
const command = commands[name];
if (!command || rest.length > 0) {
  console.log(USAGE);
  process.exitCode = name === "help" || name === "--help" ? 0 : 1;
} else {
  process.exitCode = await command();
}

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { planDev } from "../src/dev";

// `bun dev`'s sandbox-runner task: start the runner in Docker, or say in
// one line why not and what to run. Either way it never fails `bun dev`.

const root = fileURLToPath(new URL("../../..", import.meta.url));

const docker =
  spawnSync("docker", ["info", "--format", "{{.ServerVersion}}"], {
    stdio: "ignore",
    timeout: 10_000,
  }).status === 0;

const plan = planDev({
  docker,
  port: process.env.SANDBOX_RUNNER_PORT,
  token: process.env.SANDBOX_RUNNER_TOKEN,
});

if (plan.kind === "skip") {
  console.log(plan.line);
} else {
  const started = spawnSync("docker", [...plan.args], {
    cwd: root,
    stdio: "inherit",
  });
  console.log(
    started.status === 0
      ? plan.done
      : `sandbox-runner: didn't start; see above, or: docker compose --profile sandbox logs sandbox-runner`
  );
}

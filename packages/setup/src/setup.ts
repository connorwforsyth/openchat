import { err, ok, type Result } from "@workspace/shared/result";
import { parseDocument } from "yaml";

import type { Answers } from "./answers";
import { type CurrentFiles, readDefaults } from "./current";
import { parseEnv } from "./env-file";
import {
  FILES,
  type FileChange,
  planChanges,
  type RandomSecret,
  type TargetFile,
} from "./plan";
import type { Prompter } from "./prompter";
import type { Files } from "./system";
import { runWizard } from "./wizard";

// `bun run setup`: read the files, ask, validate, confirm each overwrite,
// write. Every secret stays inside the answers and `.env`; what's shown is
// variable names, never values.

export type SetupError =
  | { readonly type: "cancelled" }
  | { readonly type: "invalid-config"; readonly message: string }
  | { readonly type: "not-a-checkout" };

export const readCurrentFiles = async (
  files: Files
): Promise<Result<CurrentFiles, SetupError>> => {
  const [env, envExample, config, configExample, override] = await Promise.all(
    [
      FILES.env,
      FILES.envExample,
      FILES.config,
      FILES.configExample,
      FILES.override,
    ].map((path) => files.read(path))
  );
  if (envExample === undefined || configExample === undefined) {
    return err({ type: "not-a-checkout" });
  }
  return ok({ config, configExample, env, envExample, override });
};

const changedNames = (before: string, after: string): string[] => {
  const was = parseEnv(before);
  const now = parseEnv(after);
  return [...new Set([...Object.keys(was), ...Object.keys(now)])].filter(
    (name) => was[name] !== now[name]
  );
};

const changedSections = (before: string, after: string): string[] => {
  const read = (text: string): Record<string, unknown> =>
    (parseDocument(text).toJS() as Record<string, unknown> | null) ?? {};
  const was = read(before);
  const now = read(after);
  return [...new Set([...Object.keys(was), ...Object.keys(now)])].filter(
    (key) => JSON.stringify(was[key]) !== JSON.stringify(now[key])
  );
};

/** What an overwrite changes: names only, since `.env` values are secrets. */
export const describeChange = (change: FileChange): string => {
  if (change.before === undefined) {
    return "new file";
  }
  const names =
    change.path === FILES.env
      ? changedNames(change.before, change.after)
      : changedSections(change.before, change.after);
  return names.length > 0 ? names.join(", ") : "formatting";
};

const summary = (answers: Answers): string => {
  const services = [
    answers.search && "web search",
    answers.artifacts && "artifact previews",
  ].filter(Boolean);
  const keys = Object.keys(answers.keys);
  return [
    `Runs:       ${answers.mode === "docker" ? "Docker (compose)" : `bun dev, on ${answers.database === "pglite" ? "PGlite" : "Postgres"}`}`,
    `Models:     ${answers.strongModel ?? "first available"}${answers.fastModel ? `, fast ${answers.fastModel}` : ""}`,
    `Keys:       ${keys.length > 0 ? `${keys.join(", ")} saved in .env` : "unchanged"}`,
    `Sign-up:    ${answers.signup}`,
    `Sandboxes:  ${answers.sandbox}${answers.sandbox === "docker" ? `, network ${answers.egress}` : ""}`,
    `Services:   ${services.length > 0 ? services.join(", ") : "none"}`,
    `Icons:      ${answers.icons.set}${answers.icons.style ? ` (${answers.icons.style})` : ""}`,
  ].join("\n");
};

const nextSteps = (answers: Answers): string =>
  answers.mode === "docker"
    ? [
        "bun run setup up       build and start it, then open the URL it prints",
        "bun run setup doctor   check Docker, ports, config, health and models",
      ].join("\n")
    : [
        "bun run setup up       start what's needed in Docker, then bun dev with this config",
        "bun run setup doctor   check ports, config, health and models",
      ].join("\n");

export interface SetupDeps {
  readonly files: Files;
  readonly prompter: Prompter;
  readonly random: RandomSecret;
}

/** Resolves with the files written (none when nothing changed or all were declined). */
export const runSetup = async ({
  files,
  prompter,
  random,
}: SetupDeps): Promise<Result<readonly TargetFile[], SetupError>> => {
  const current = await readCurrentFiles(files);
  if (!current.ok) {
    return current;
  }
  const answers = await runWizard(prompter, readDefaults(current.value));
  if (!answers.ok) {
    return answers;
  }
  const plan = planChanges(current.value, answers.value, random);
  if (!plan.ok) {
    prompter.warn(
      `That would make an app.config.yaml the app can't start with, so nothing was written:\n${plan.error.message}`
    );
    return err({ message: plan.error.message, type: "invalid-config" });
  }

  const written: TargetFile[] = [];
  for (const change of plan.value) {
    if (change.before !== undefined) {
      // biome-ignore lint/performance/noAwaitInLoops: one question at a time, in order.
      const confirmed = await prompter.confirm({
        id: `overwrite:${change.path}`,
        initial: true,
        message: `Update ${change.path}? (${describeChange(change)})`,
      });
      if (confirmed !== true) {
        prompter.warn(`Left ${change.path} as it was.`);
        continue;
      }
    }
    await files.write(change.path, change.after, {
      secret: change.path === FILES.env,
    });
    written.push(change.path);
  }

  prompter.note(summary(answers.value), "Setup");
  if (plan.value.length === 0) {
    prompter.info("Everything already matches; nothing to write.");
  } else if (written.length > 0) {
    prompter.info(`Wrote ${written.join(", ")}.`);
  }
  prompter.note(nextSteps(answers.value), "Next");
  return ok(written);
};

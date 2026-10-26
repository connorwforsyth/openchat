import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";

import { createJudge } from "@workspace/ai/evals/judge";
import {
  describeEvalModel,
  evalLanguageModel,
} from "@workspace/ai/evals/model";
import { parseConfig } from "@workspace/config/parse";
import { effectivePrices } from "@workspace/config/prices";
import type { AppConfig } from "@workspace/config/schema";
import { parse as parseYaml } from "yaml";

import { portFor, readCheckout } from "../../../scripts/ci/dev-port";
import { suites as allSuites } from "../suites";
import type { Judge } from "./judge";
import { junitOf } from "./junit";
import {
  blockers,
  ciRefusal,
  envReferences,
  estimateLive,
  type LiveTarget,
  preflight,
} from "./live";
import { startLiveServer } from "./live-server";
import { type CaseResult, type Report, summaryOf } from "./report";
import { runSuites, suitesFor } from "./runner";
import { REPO_ROOT, type RunningServer, startServer } from "./server";
import type { Suite } from "./suite";
import { createWorld } from "./world";

// `bun run evals [--strict] [--suite <name>]…`: boots the app, runs the
// deterministic suites against it over HTTP, and writes `report.json`,
// `junit.xml` and the server's output to `.evals/<timestamp>/`.
//
// Without `--strict` the run only reports: it exits 0 whatever the cases
// found (and non-zero only if it couldn't run at all). With it, a gate
// failure, a broken case or an expected failure that passed fails the run;
// soft failures, expected failures and skips never do.
//
// `--live --model <alias> [--judge <alias>]` runs the live cases instead,
// against real providers from app.config.yaml (or CONFIG_PATH). It prints
// what it will call and a rough token estimate, and calls nothing until
// `--yes` (or a yes at the prompt). It refuses to run in CI without
// `--allow-ci`, and it is never part of the gate or `turbo test`.

// The main checkout's port; a linked worktree gets its own (140).
const DEFAULT_PORT = 3184;
/** A real model takes longer than the mock; a live case gets this long. */
const LIVE_CASE_TIMEOUT_MS = 180_000;

const USAGE = `bun run evals [options]

  --strict          exit non-zero on any gate failure
  --suite <name>    run only this suite (repeatable)
  --port <number>   the port to boot the app on (EVALS_PORT; ${DEFAULT_PORT},
                    or this worktree's own)
  --out <dir>       where reports go (.evals)
  --list            print the suites and cases, and exit

Live mode (opt-in; calls real models and may cost money):

  --live            run the live cases against real providers from
                    app.config.yaml (or CONFIG_PATH), not the mock
  --model <alias>   the model under test: an alias or provider:model ref
  --judge <alias>   the model that judges; without it judged checks are skipped
  --yes             run without asking, once the plan is printed
  --allow-ci        run even though CI is set`;

const stamp = (date: Date): string =>
  date.toISOString().replaceAll(":", "-").replace(".", "-");

const MARK: Record<CaseResult["outcome"], string> = {
  error: "E",
  "expected-failure": "x",
  "gate-failed": "F",
  passed: ".",
  skipped: "s",
  "soft-failed": "~",
  "unexpected-pass": "X",
};

interface Live {
  readonly aliases: unknown;
  readonly env: readonly string[];
  readonly judge: Judge | null;
  readonly model: string;
  readonly providers: Readonly<Record<string, unknown>>;
}

interface Invocation {
  readonly live: Live | null;
  readonly outDir: string;
  readonly port: number;
  readonly strict: boolean;
  readonly suites: readonly Suite[];
}

type Values = ReturnType<typeof parseCommandLine>["values"];

const parseCommandLine = () =>
  parseArgs({
    options: {
      "allow-ci": { type: "boolean" },
      help: { short: "h", type: "boolean" },
      judge: { type: "string" },
      list: { type: "boolean" },
      live: { type: "boolean" },
      model: { type: "string" },
      out: { type: "string" },
      port: { type: "string" },
      strict: { type: "boolean" },
      suite: { multiple: true, type: "string" },
      yes: { short: "y", type: "boolean" },
    },
  });

const configFile = (): string => {
  const explicit = process.env.CONFIG_PATH?.trim();
  if (!explicit) {
    return join(REPO_ROOT, "app.config.yaml");
  }
  return isAbsolute(explicit) ? explicit : resolve(REPO_ROOT, explicit);
};

const confirmed = async (yes: boolean): Promise<boolean> => {
  if (yes) {
    return true;
  }
  if (!process.stdin.isTTY) {
    console.log("\nNothing was called. Pass --yes to run it.");
    return false;
  }
  const prompt = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const answer = await prompt.question("\nRun it? [y/N] ");
    return answer.trim().toLowerCase().startsWith("y");
  } finally {
    prompt.close();
  }
};

/** Why live mode won't run; printed as it is, and the run exits 2. */
class Refusal extends Error {}

const refuse = (message: string): never => {
  throw new Refusal(message);
};

interface LiveConfig {
  readonly config: AppConfig;
  readonly path: string;
  /** As written, `${NAME}` references and all: the app is given these, not keys. */
  readonly raw: {
    readonly models?: { readonly aliases?: unknown };
    readonly providers?: Readonly<Record<string, unknown>>;
  };
}

const readLiveConfig = async (): Promise<LiveConfig> => {
  const path = configFile();
  const text = await readFile(path, "utf8").catch(() => null);
  if (text === null) {
    return refuse(
      `Live mode reads the providers from ${path}, which doesn't exist. Create it (see app.config.example.yaml) or set CONFIG_PATH.${
        process.env.TURBO_HASH && !process.env.CONFIG_PATH
          ? " Under `bun run evals` turbo doesn't pass CONFIG_PATH (or provider keys) to this task: run `bun packages/evals/src/cli.ts --live …` instead."
          : ""
      }`
    );
  }
  const parsed = parseConfig(text, process.env);
  if (!parsed.ok) {
    return refuse(
      `${path} isn't valid:\n${parsed.error.map((each) => `  ${each.path.join(".")}: ${each.message}`).join("\n")}`
    );
  }
  return { config: parsed.value, path, raw: parseYaml(text) ?? {} };
};

const targetOf = (
  { config, raw }: LiveConfig,
  selector: string
): LiveTarget => {
  const described = describeEvalModel(config, selector);
  if (!described.ok) {
    return refuse(described.error);
  }
  return {
    env: envReferences(raw.providers?.[described.value.provider]),
    target: described.value,
  };
};

const judgeOf = (
  { config }: LiveConfig,
  target: LiveTarget | null
): Judge | null => {
  if (!target) {
    return null;
  }
  const built = evalLanguageModel(config, target.target);
  return built.ok
    ? createJudge({ model: built.value, name: target.target.ref })
    : refuse(`The judge can't be built: ${built.error}`);
};

/**
 * Live mode's plan: what it will call, printed, then confirmed. Nothing
 * here calls a model; a refusal is thrown as a `Refusal`.
 */
const planLive = async (
  values: Values,
  suites: readonly Suite[]
): Promise<Live | null> => {
  const refusal = ciRefusal(process.env, values["allow-ci"] ?? false);
  if (refusal) {
    return refuse(refusal);
  }
  const selector =
    values.model ?? refuse("--live needs --model <alias or provider:model>.");
  const live = await readLiveConfig();
  const model = targetOf(live, selector);
  const judge = values.judge ? targetOf(live, values.judge) : null;
  const estimate = estimateLive(suites, { judged: judge !== null });
  console.log(
    preflight({
      configPath: live.path,
      estimate,
      isSet: (name) => Boolean(process.env[name]),
      judge,
      model,
      prices: effectivePrices(live.config),
    })
  );
  const blocked = blockers(judge ? [model, judge] : [model], estimate);
  if (blocked.length > 0) {
    return refuse(
      `\nCan't run:\n${blocked.map((each) => `  ${each}`).join("\n")}`
    );
  }
  const judgeInstance = judgeOf(live, judge);
  if (!(await confirmed(values.yes ?? false))) {
    return null;
  }
  const providers = live.raw.providers ?? {};
  return {
    aliases: live.raw.models?.aliases,
    env: envReferences(providers),
    judge: judgeInstance,
    model: model.target.ref,
    providers,
  };
};

const chooseSuites = (values: Values): readonly Suite[] => {
  const wanted = values.suite ?? [];
  const unknown = wanted.filter(
    (name) => !allSuites.some((suite) => suite.name === name)
  );
  if (unknown.length > 0) {
    refuse(
      `No suite named ${unknown.join(", ")}. There are: ${allSuites.map((suite) => suite.name).join(", ")}.`
    );
  }
  const chosen =
    wanted.length === 0
      ? allSuites
      : allSuites.filter((suite) => wanted.includes(suite.name));
  return suitesFor(chosen, values.live ? "live" : "deterministic");
};

const printList = (suites: readonly Suite[]) => {
  for (const suite of suites) {
    console.log(`${suite.name}: ${suite.proves}`);
    for (const each of suite.cases) {
      const note = each.todo ? "(todo) " : "";
      console.log(`  ${note}${each.live ? "(live) " : ""}${each.name}`);
    }
  }
};

/** What the command line asks for, or the exit code it already earned. */
const parse = async (): Promise<Invocation | number> => {
  const { values } = parseCommandLine();
  if (values.help) {
    console.log(USAGE);
    return 0;
  }
  if (!values.live && (values.model || values.judge || values.yes)) {
    refuse(
      "--model, --judge and --yes are for live mode; add --live (the deterministic run uses the mock model)."
    );
  }
  const suites = chooseSuites(values);
  if (values.list) {
    printList(suites);
    return 0;
  }
  const live = values.live ? await planLive(values, suites) : null;
  if (values.live && !live) {
    // Not confirmed: nothing was called.
    return 2;
  }
  return {
    live,
    outDir: join(values.out ?? join(REPO_ROOT, ".evals"), stamp(new Date())),
    port: Number(
      values.port ??
        process.env.EVALS_PORT ??
        portFor(DEFAULT_PORT, readCheckout())
    ),
    strict: values.strict ?? false,
    suites,
  };
};

/** `parse`, with a refusal printed as it is. */
const invocationOf = async (): Promise<Invocation | number> => {
  try {
    return await parse();
  } catch (cause) {
    if (cause instanceof Refusal) {
      console.error(cause.message);
      return 2;
    }
    throw cause;
  }
};

const write = async (outDir: string, report: Report, serverLog: string) => {
  await mkdir(outDir, { recursive: true });
  await Promise.all([
    writeFile(
      join(outDir, "report.json"),
      `${JSON.stringify(report, null, 2)}\n`
    ),
    writeFile(join(outDir, "junit.xml"), junitOf(report)),
    writeFile(join(outDir, "server.log"), serverLog),
  ]);
};

const boot = (invocation: Invocation): Promise<RunningServer> => {
  const { live, port } = invocation;
  console.log(
    `${live ? "\n" : ""}Booting the app on port ${port}${live ? ` with ${live.model}` : ""}…`
  );
  return live ? startLiveServer({ ...live, port }) : startServer(port);
};

const main = async (): Promise<number> => {
  const invocation = await invocationOf();
  if (typeof invocation === "number") {
    return invocation;
  }
  const { live, outDir, strict, suites } = invocation;
  const server = await boot(invocation);
  try {
    const world = await createWorld(server.baseUrl);
    let line = "";
    const report = await runSuites(suites, {
      ...(live
        ? {
            caseTimeoutMs: LIVE_CASE_TIMEOUT_MS,
            ...(live.judge ? { judge: live.judge } : {}),
            mode: "live" as const,
            model: live.model,
          }
        : {}),
      onCase: (suite, result) => {
        if (line !== suite) {
          process.stdout.write(`${line ? "\n" : ""}${suite} `);
          line = suite;
        }
        process.stdout.write(MARK[result.outcome]);
      },
      strict,
      world,
    });
    process.stdout.write("\n\n");
    console.log(summaryOf(report));
    await write(outDir, report, server.log());
    console.log(`\nReport: ${outDir}`);
    if (!report.ok) {
      console.log(
        strict
          ? "Failed: a gate failed (--strict)."
          : "A gate failed; pass --strict to fail the run on it."
      );
    }
    return strict && !report.ok ? 1 : 0;
  } finally {
    await server.stop();
  }
};

main()
  .then((code) => {
    process.exit(code);
  })
  .catch((cause: unknown) => {
    console.error("[evals] couldn't run:", cause);
    process.exit(1);
  });

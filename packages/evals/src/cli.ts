import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { suites as allSuites } from "../suites";
import { junitOf } from "./junit";
import { type CaseResult, type Report, summaryOf } from "./report";
import { runSuites } from "./runner";
import { REPO_ROOT, startServer } from "./server";
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

const DEFAULT_PORT = 3184;

const USAGE = `bun run evals [options]

  --strict          exit non-zero on any gate failure
  --suite <name>    run only this suite (repeatable)
  --port <number>   the port to boot the app on (EVALS_PORT, ${DEFAULT_PORT})
  --out <dir>       where reports go (.evals)
  --list            print the suites and cases, and exit`;

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

interface Invocation {
  readonly outDir: string;
  readonly port: number;
  readonly strict: boolean;
  readonly suites: readonly Suite[];
}

/** What the command line asks for, or the exit code it already earned. */
const parse = (): Invocation | number => {
  const { values } = parseArgs({
    options: {
      help: { short: "h", type: "boolean" },
      list: { type: "boolean" },
      live: { type: "boolean" },
      out: { type: "string" },
      port: { type: "string" },
      strict: { type: "boolean" },
      suite: { multiple: true, type: "string" },
    },
  });
  if (values.help) {
    console.log(USAGE);
    return 0;
  }
  if (values.live) {
    console.error(
      "Live mode and the judge are ticket 085; this runs the deterministic suites only."
    );
    return 2;
  }
  const wanted = values.suite ?? [];
  const unknown = wanted.filter(
    (name) => !allSuites.some((suite) => suite.name === name)
  );
  if (unknown.length > 0) {
    console.error(
      `No suite named ${unknown.join(", ")}. There are: ${allSuites.map((suite) => suite.name).join(", ")}.`
    );
    return 2;
  }
  const suites =
    wanted.length === 0
      ? allSuites
      : allSuites.filter((suite) => wanted.includes(suite.name));
  if (values.list) {
    for (const suite of suites) {
      console.log(`${suite.name}: ${suite.proves}`);
      for (const each of suite.cases) {
        console.log(`  ${each.todo ? "(todo) " : ""}${each.name}`);
      }
    }
    return 0;
  }
  return {
    outDir: join(values.out ?? join(REPO_ROOT, ".evals"), stamp(new Date())),
    port: Number(values.port ?? process.env.EVALS_PORT ?? DEFAULT_PORT),
    strict: values.strict ?? false,
    suites,
  };
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

const main = async (): Promise<number> => {
  const invocation = parse();
  if (typeof invocation === "number") {
    return invocation;
  }
  const { outDir, port, strict, suites } = invocation;
  console.log(`Booting the app on port ${port}…`);
  const server = await startServer(port);
  try {
    const world = await createWorld(server.baseUrl);
    let line = "";
    const report = await runSuites(suites, {
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

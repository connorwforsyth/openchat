// Model-checks the branch run queue (RunQueue.tla) with TLC and compares
// every check with the result SKILL.md records. Exits 0 only when each check
// came out as expected; prints each counterexample in the code's words.
// Needs no model provider, no database and no network once tools are cached.
//
//   bun .claude/skills/verify-run-queue/model/check.ts            the default checks
//   bun .claude/skills/verify-run-queue/model/check.ts queue      checks by name
//   bun .claude/skills/verify-run-queue/model/check.ts --narrate tlc.log
//
// Tools are pinned and cached in ~/.cache/tla-tools (or $XDG_CACHE_HOME):
// tla2tools.jar 1.7.4, and a Temurin 21 JRE when no `java` is on PATH ($JAVA
// overrides both). Downloads are checked against the SHA-256 sums below.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { arch, homedir, platform, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MODEL_DIR = dirname(fileURLToPath(import.meta.url));
const CACHE = join(
  process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"),
  "tla-tools"
);

const JAR = {
  file: "tla2tools-1.7.4.jar",
  sha256: "936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88",
  url: "https://github.com/tlaplus/tlaplus/releases/download/v1.7.4/tla2tools.jar",
};

const JRE_VERSION = "21.0.12.1+1";
const JRE_SUMS: Readonly<Record<string, string>> = {
  "linux-aarch64":
    "14be1f35ebdbd1f6e8d57eb911a3ffb74d6d9aa255abc5daf2b1302002cf2cf2",
  "linux-x64":
    "2413149700df0f7d440500a84a8f764c535f21e5a5e87d38328b64eec2c5b500",
  "mac-aarch64":
    "dec50fc6f9fcd4fe3ae8cabf5a5fa68f6afc48841f7698e468e9aa5d54beed84",
  "mac-x64": "6717ec641fd9ce0bb209ca083ee23b42202ac68cb6fcc5753496e0e4a0f41989",
};

type Expect = "holds" | "violated";

interface Check {
  readonly config: string;
  readonly expect: Expect;
  readonly invariants: readonly string[];
  readonly name: string;
  /** Left out of the default run; run it by name. */
  readonly optIn?: boolean;
  /** The VIEW in RunQueue.tla: it must keep every ghost the invariants read. */
  readonly view: string;
}

// Keep in step with the results table in SKILL.md. Each "violated" is a
// finding in the current code, with its counterexample recorded there.
const CHECKS: readonly Check[] = [
  {
    config: "RunQueueSendOnly.cfg",
    expect: "holds",
    invariants: [
      "EndedRunsAreIdle",
      "OneRunPerBranch",
      "NoStuckRun",
      "SettledOnce",
      "OnePassPerRun",
    ],
    name: "queue",
    view: "ViewAll",
  },
  {
    config: "RunQueueSendOnly.cfg",
    expect: "holds",
    invariants: ["StopReachesPass"],
    name: "double-start",
    view: "View",
  },
  {
    config: "RunQueueStop.cfg",
    expect: "holds",
    invariants: ["EndedRunsAreIdle", "NoLoopAfterStop"],
    name: "stop-start",
    view: "View",
  },
  {
    config: "RunQueueStop.cfg",
    expect: "violated",
    invariants: ["OneRunPerBranch"],
    name: "stop-branch",
    view: "ViewBranch",
  },
  {
    config: "RunQueueStop.cfg",
    expect: "holds",
    invariants: ["SettledOnce"],
    name: "stop-settled",
    view: "ViewSettled",
  },
  {
    config: "RunQueueStop.cfg",
    expect: "holds",
    invariants: ["NoStuckRun"],
    name: "stop-stranded",
    view: "View",
  },
  {
    config: "RunQueueStopApproval.cfg",
    expect: "holds",
    invariants: ["EndedRunsAreIdle", "NoLoopAfterStop"],
    name: "stop-approval",
    view: "View",
  },
  {
    config: "RunQueueStopPause.cfg",
    expect: "holds",
    invariants: ["StopTakesEffect", "NoLoopAfterStop", "EndedRunsAreIdle"],
    name: "stop-pause",
    view: "ViewStopped",
  },
  {
    // The slowest check, so it runs only by name. See SKILL.md, finding 1.
    config: "RunQueueApprovals.cfg",
    expect: "holds",
    invariants: ["NoStuckRun"],
    name: "approval-lost",
    optIn: true,
    view: "View",
  },
];

// --- tools ---

const sha256 = (path: string): string =>
  createHash("sha256").update(readFileSync(path)).digest("hex");

const download = async (url: string, to: string, sum: string) => {
  process.stdout.write(`downloading ${url}\n`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`download failed: ${response.status} ${url}`);
  }
  writeFileSync(to, new Uint8Array(await response.arrayBuffer()));
  if (sha256(to) !== sum) {
    rmSync(to);
    throw new Error(`checksum mismatch for ${url}`);
  }
};

const succeeds = (command: string, args: readonly string[]): boolean =>
  spawnSync(command, args, { stdio: "ignore" }).status === 0;

const findJava = async (): Promise<string> => {
  if (process.env.JAVA) {
    return process.env.JAVA;
  }
  // macOS ships a `java` stub that fails when no runtime is installed.
  if (succeeds("java", ["-version"])) {
    return "java";
  }
  const os = platform() === "darwin" ? "mac" : "linux";
  const cpu = arch() === "arm64" ? "aarch64" : "x64";
  const sum = JRE_SUMS[`${os}-${cpu}`];
  if (!sum) {
    throw new Error(`no pinned JRE for ${os}-${cpu}: install Java 11+`);
  }
  const dir = join(CACHE, `jre-${JRE_VERSION.replace("+", "_")}-${os}-${cpu}`);
  const home = os === "mac" ? join(dir, "Contents", "Home") : dir;
  const java = join(home, "bin", "java");
  if (!existsSync(java)) {
    mkdirSync(dir, { recursive: true });
    const archive = join(CACHE, "jre.tar.gz");
    await download(
      `https://api.adoptium.net/v3/binary/version/jdk-${encodeURIComponent(JRE_VERSION)}/${os}/${cpu}/jre/hotspot/normal/eclipse`,
      archive,
      sum
    );
    const unpacked = succeeds("tar", [
      "-xzf",
      archive,
      "-C",
      dir,
      "--strip-components",
      "1",
    ]);
    rmSync(archive);
    if (!unpacked) {
      throw new Error("couldn't unpack the JRE");
    }
  }
  return java;
};

const findJar = async (): Promise<string> => {
  const jar = join(CACHE, JAR.file);
  if (!existsSync(jar) || sha256(jar) !== JAR.sha256) {
    mkdirSync(CACHE, { recursive: true });
    await download(JAR.url, jar, JAR.sha256);
  }
  return jar;
};

// --- TLC values: just enough of the syntax TLC prints in a trace ---

type Value =
  | boolean
  | number
  | string
  | readonly Value[]
  | { readonly fn: ReadonlyMap<string, Value> }
  | { readonly record: Readonly<Record<string, Value>> };

const TOKEN = /\s*(<<|>>|:>|@@|\|->|"(?:[^"\\]|\\.)*"|-?\d+|[A-Za-z_]\w*|\S)/y;
const NUMBER = /^-?\d+$/;

const tokenize = (text: string): string[] => {
  const tokens: string[] = [];
  TOKEN.lastIndex = 0;
  for (let match = TOKEN.exec(text); match; match = TOKEN.exec(text)) {
    tokens.push(match[1] as string);
  }
  return tokens;
};

const key = (value: Value | undefined): string => JSON.stringify(value);

const parseValue = (tokens: readonly string[]): Value => {
  let at = 0;
  const next = () => {
    at += 1;
    return tokens[at - 1] as string;
  };
  const peek = () => tokens[at];
  const skip = (token: string) => {
    if (peek() === token) {
      next();
    }
  };
  const items = (close: string): Value[] => {
    const found: Value[] = [];
    while (at < tokens.length && peek() !== close) {
      found.push(value());
      skip(",");
    }
    next();
    return found;
  };
  const record = (): Value => {
    const fields: Record<string, Value> = {};
    while (at < tokens.length && peek() !== "]") {
      const field = next();
      next(); // |->
      fields[field] = value();
      skip(",");
    }
    next();
    return { record: fields };
  };
  const fn = (): Value => {
    const entries = new Map<string, Value>();
    while (at < tokens.length && peek() !== ")") {
      const domain = value();
      next(); // :>
      entries.set(key(domain), value());
      skip("@@");
    }
    next();
    return { fn: entries };
  };
  const value = (): Value => {
    const token = next();
    switch (token) {
      case "<<":
        return items(">>");
      case "{":
        return items("}");
      case "[":
        return record();
      case "(":
        return fn();
      case "TRUE":
        return true;
      case "FALSE":
        return false;
      default:
        if (token.startsWith('"')) {
          return JSON.parse(token) as string;
        }
        return NUMBER.test(token) ? Number(token) : token;
    }
  };
  return value();
};

interface TraceState {
  readonly action: string;
  readonly vars: ReadonlyMap<string, Value>;
}

const STATE_HEADER = /^State \d+: <(\S+)/;
const VAR_LINE = /^\/\\ (\w+) = (.*)$/;

const parseTrace = (output: string): TraceState[] => {
  const states: TraceState[] = [];
  let action = "";
  let vars = new Map<string, Value>();
  let pending: { readonly name: string; text: string } | null = null;
  const flushVar = () => {
    if (pending) {
      vars.set(pending.name, parseValue(tokenize(pending.text)));
      pending = null;
    }
  };
  const flushState = () => {
    flushVar();
    if (action) {
      states.push({ action, vars });
    }
    action = "";
    vars = new Map();
  };
  for (const line of output.split("\n")) {
    const header = STATE_HEADER.exec(line);
    const assignment = VAR_LINE.exec(line);
    if (header) {
      flushState();
      action = header[1] as string;
    } else if (assignment && action) {
      flushVar();
      pending = {
        name: assignment[1] as string,
        text: assignment[2] as string,
      };
    } else if (pending && line.trim() !== "") {
      pending.text += ` ${line}`;
    } else {
      flushState();
    }
  }
  flushState();
  return states;
};

// --- narration, in the code's words ---

const fnOf = (value: Value | undefined): ReadonlyMap<string, Value> =>
  value && typeof value === "object" && "fn" in value ? value.fn : new Map();

const seqOf = (value: Value | undefined): readonly Value[] =>
  Array.isArray(value) ? value : [];

/** What one step did, given the state before and after it. */
interface Step {
  readonly after: TraceState;
  readonly before: TraceState;
  /** The process that moved, as a `key`. */
  readonly proc: string;
}

const local = (
  step: Step,
  name: string,
  when: "after" | "before"
): Value | undefined => fnOf(step[when].vars.get(name)).get(step.proc);

const statusOf = (state: TraceState, run: number): Value | undefined =>
  seqOf(state.vars.get("status"))[run - 1];

const changed = (step: Step, name: string): boolean =>
  key(step.before.vars.get(name)) !== key(step.after.vars.get(name));

const TERMINAL: ReadonlySet<string> = new Set([
  "cancelled",
  "failed",
  "succeeded",
]);

const transition = (step: Step, run: number, lost: string): string => {
  const before = statusOf(step.before, run);
  const after = statusOf(step.after, run);
  return before === after ? lost : `${String(before)} -> ${String(after)}`;
};

const STEPS: Readonly<Record<string, (step: Step, run: number) => string>> = {
  D_Lock: (_, run) =>
    run === 0
      ? "no decision comes"
      : `submitApprovals(r${run}): recordDecisions locks the run (awaiting_approval)`,
  D_Resume: (step, run) =>
    changed(step, "active")
      ? `storeDecisions(r${run}): transitionRun(resume) ${transition(step, run, "lost")}; active.set(r${run}, controller); COMMIT`
      : `storeDecisions(r${run}): transitionRun(resume) ${transition(step, run, "lost")}, COMMIT`,
  D_Spawn: (step, run) =>
    changed(step, "spawned")
      ? `submitApprovals(r${run}): the resumed pass starts with the decision's controller`
      : `submitApprovals(r${run}): not resumed, so no pass starts`,
  F_List: (_, run) =>
    `finishTerminal(r${run}): writer.close, onSettled, promoteAfter's listQueuedAfter`,
  F_Loop: (step, run) => {
    const cur = Number(local(step, "cur", "after"));
    return local(step, "queue", "before") === undefined ||
      seqOf(local(step, "queue", "before")).length === 0
      ? `promoteAfter(r${run}) returns${changed(step, "active") ? "; execute's finally: active.delete" : ""}`
      : `promoteAfter(r${run}): startRun(r${cur})`;
  },
  K_Abort2: (step, run) =>
    changed(step, "aborted")
      ? `cancel(r${run}): abortPass() again aborts a controller`
      : `cancel(r${run}): abortPass() again finds no controller`,
  K_After: (_, run) => `cancel(r${run}): the pass settled; getRun again`,
  K_Idle: (step, run) =>
    `cancelIdle(r${run}): transitionRun(cancel) ${transition(step, run, "lost, returns false")}`,
  K_Promote: (step, run) =>
    seqOf(local(step, "behind", "before")).length === 0
      ? `cancelIdle(r${run}): returns`
      : `cancelIdle(r${run}): startRun(r${String(local(step, "nextRun", "after"))}), a run it moved`,
  K_Read: (step, run) => {
    if (run === 0) {
      return "no Stop comes";
    }
    return changed(step, "aborted")
      ? `cancel(r${run}): getRun; abortPass aborts the controller in active`
      : `cancel(r${run}): getRun (${String(statusOf(step.after, run))}); abortPass finds no controller, so cancelIdle`;
  },
  K_Requeue: (step, run) =>
    `cancelIdle(r${run}): requeueAfter moves the runs behind r${run} to wait on r${String(seqOf(step.after.vars.get("after"))[run - 1])}; finishTerminal(r${run})`,
  K_Wait2: (_, run) => `cancel(r${run}): await running.get`,
  P_Begin: (step, run) =>
    changed(step, "begun")
      ? `execute(r${run}): runAgent begins (model calls, approved calls)`
      : `execute(r${run}): Stop came first; settles as cancelled without calling runAgent`,
  P_Loop: (step, run) =>
    `execute(r${run}): the agent loop ends -> ${String(local(step, "outcome", "after"))}`,
  P_Settle: (step, run) =>
    `settle(r${run}): transitionRun(${String(local(step, "outcome", "before"))}) ${transition(step, run, "lost; report")}`,
  S_Ahead: (step, run) => {
    const ahead = Number(local(step, "srAfter", "before"));
    const status = String(statusOf(step.after, ahead));
    return TERMINAL.has(status)
      ? `startRun(r${run}): getRun(r${ahead}) is ${status}; claim`
      : `startRun(r${run}): getRun(r${ahead}) is ${status}; still waiting`;
  },
  S_Claim: (step, run) =>
    changed(step, "spawned")
      ? `startRun(r${run}): claim ${transition(step, run, "")}; active.set(r${run}, controller), COMMIT; track(execute) starts its pass`
      : `startRun(r${run}): claim lost (${String(statusOf(step.after, run))}), rolled back`,
  S_Read: (step, run) => {
    const status = String(statusOf(step.before, run));
    const ahead = seqOf(step.before.vars.get("after"))[run - 1];
    const read = `getRun (${status}${ahead ? ` behind r${String(ahead)}` : ""})`;
    return status === "queued"
      ? `startRun(r${run}): ${read}`
      : `startRun(r${run}): ${read}: already started`;
  },
  W_Insert: (step, run) => {
    const behind = seqOf(step.after.vars.get("after"))[run - 1];
    return `createRun(r${run}): commits the message and run r${run}, queued${behind ? ` behind r${String(behind)}` : ""}; executor.start`;
  },
  W_Read: (step, run) => {
    const tail = Number(local(step, "tail", "after"));
    return `createRun(r${run}): listActiveRuns + busyTail: ${tail ? `r${tail} is busy there` : "nothing busy there"}`;
  },
};

const runOf = (label: string, step: Step): number => {
  const prefix = label.slice(0, 2);
  if (prefix === "S_") {
    return Number(local(step, "sr", "before"));
  }
  if (prefix === "F_") {
    return Number(local(step, "fr", "before"));
  }
  if (prefix === "K_") {
    return Number(local(step, "tgt", "after"));
  }
  if (prefix === "D_") {
    return Number(local(step, "dtgt", "after"));
  }
  return Number(seqOf(JSON.parse(step.proc) as Value)[1]);
};

const describeRuns = (state: TraceState): string => {
  const behind = seqOf(state.vars.get("after"));
  const spawned = seqOf(state.vars.get("spawned"));
  return seqOf(state.vars.get("status"))
    .map((status, index) => {
      const run = `r${index + 1}`;
      if (status === "none") {
        return `${run} -`;
      }
      const queued =
        status === "queued" && behind[index]
          ? ` behind r${String(behind[index])}`
          : "";
      const pass = seqOf(spawned[index]).length > 0 ? " [pass executing]" : "";
      return `${run} ${String(status)}${queued}${pass}`;
    })
    .join(" | ");
};

const narrate = (states: readonly TraceState[]): string => {
  const [first] = states;
  if (!first) {
    return "  (no trace)";
  }
  const lines = [`   0. ${describeRuns(first)}`];
  for (const [index, after] of states.entries()) {
    const before = states[index - 1];
    if (!before) {
      continue;
    }
    const pcBefore = fnOf(before.vars.get("pc"));
    const pcAfter = fnOf(after.vars.get("pc"));
    const stackBefore = fnOf(before.vars.get("stack"));
    const stackAfter = fnOf(after.vars.get("stack"));
    const proc = [...pcAfter.keys()].find(
      (p) =>
        key(pcAfter.get(p)) !== key(pcBefore.get(p)) ||
        key(stackAfter.get(p)) !== key(stackBefore.get(p))
    );
    const number = String(index).padStart(4);
    if (!proc) {
      lines.push(`${number}. ${after.action}`);
      continue;
    }
    const step = { after, before, proc };
    const [kind, id] = seqOf(JSON.parse(proc) as Value);
    const describe = STEPS[after.action];
    const text = describe
      ? describe(step, runOf(after.action, step))
      : after.action;
    lines.push(
      `${number}. ${String(kind)} ${String(id)}: ${text}`,
      `        ${describeRuns(after)}`
    );
  }
  return lines.join("\n");
};

// --- running TLC ---

const DISTINCT_STATES = /([\d,]+) distinct states found/g;
const INVARIANT_VIOLATED = /Error: Invariant (\w+) is violated/;

interface Result {
  readonly detail: string;
  readonly outcome: Expect | "error";
  readonly seconds: number;
  readonly trace: string;
}

/** A scratch copy of the model with its PlusCal translated. */
const prepare = (java: string, jar: string): string => {
  const work = mkdtempSync(join(tmpdir(), "run-queue-"));
  copyFileSync(join(MODEL_DIR, "RunQueue.tla"), join(work, "RunQueue.tla"));
  const translated = spawnSync(
    java,
    ["-cp", jar, "pcal.trans", "-nocfg", "RunQueue.tla"],
    { cwd: work, encoding: "utf8" }
  );
  if (
    translated.status !== 0 ||
    !translated.stdout.includes("Translation completed")
  ) {
    throw new Error(
      `PlusCal translation failed:\n${translated.stdout}${translated.stderr}`
    );
  }
  return work;
};

const runCheck = (
  java: string,
  jar: string,
  work: string,
  check: Check
): Result => {
  const config = join(work, `${check.name}.cfg`);
  copyFileSync(join(MODEL_DIR, check.config), config);
  appendFileSync(
    config,
    `VIEW ${check.view}\nINVARIANTS\n${check.invariants.map((name) => `  ${name}\n`).join("")}`
  );
  // A request that can never return is a TLC deadlock (CheckedSpec lets
  // only settled states stutter), so it counts against NoStuckRun.
  const checkDeadlock = check.invariants.includes("NoStuckRun");
  const started = Date.now();
  const tlc = spawnSync(
    java,
    [
      "-XX:+UseParallelGC",
      "-cp",
      jar,
      "tlc2.TLC",
      "-config",
      config,
      ...(checkDeadlock ? [] : ["-deadlock"]),
      "-workers",
      "auto",
      "-metadir",
      join(work, `states-${check.name}`),
      "-cleanup",
      "RunQueue.tla",
    ],
    { cwd: work, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }
  );
  const seconds = Math.round((Date.now() - started) / 1000);
  const output = `${tlc.stdout}${tlc.stderr}`;
  // The last count is the final one; earlier ones are progress reports.
  const states = [...output.matchAll(DISTINCT_STATES)].at(-1)?.[1] ?? "?";
  if (output.includes("No error has been found")) {
    return {
      detail: `${states} distinct states`,
      outcome: "holds",
      seconds,
      trace: "",
    };
  }
  const violated = INVARIANT_VIOLATED.exec(output)?.[1];
  const deadlocked = output.includes("Error: Deadlock reached");
  if (violated || deadlocked) {
    const trace = parseTrace(output);
    return {
      detail: `${violated ?? "NoStuckRun (deadlock: a request never returns)"} in ${trace.length - 1} steps`,
      outcome: "violated",
      seconds,
      trace: narrate(trace),
    };
  }
  return {
    detail: "TLC failed",
    outcome: "error",
    seconds,
    trace: output.slice(-4000),
  };
};

const main = async (args: readonly string[]): Promise<number> => {
  if (args[0] === "--narrate" && args[1]) {
    process.stdout.write(
      `${narrate(parseTrace(readFileSync(args[1], "utf8")))}\n`
    );
    return 0;
  }
  const selected =
    args.length > 0
      ? CHECKS.filter((check) => args.includes(check.name))
      : CHECKS.filter((check) => !check.optIn);
  if (selected.length === 0) {
    process.stdout.write(
      `checks: ${CHECKS.map((check) => check.name).join(", ")}\n`
    );
    return 2;
  }
  const java = await findJava();
  const jar = await findJar();
  const work = prepare(java, jar);
  let failed = 0;
  try {
    for (const check of selected) {
      const result = runCheck(java, jar, work, check);
      const ok = result.outcome === check.expect;
      failed += ok ? 0 : 1;
      process.stdout.write(
        `${ok ? "ok  " : "FAIL"} ${check.name.padEnd(14)} expected ${check.expect}, got ${result.outcome}: ${result.detail} [${result.seconds}s]\n`
      );
      if (result.trace) {
        process.stdout.write(`${result.trace}\n\n`);
      }
    }
  } finally {
    rmSync(work, { force: true, recursive: true });
  }
  return failed === 0 ? 0 : 1;
};

process.exitCode = await main(process.argv.slice(2));

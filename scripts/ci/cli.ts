// The imperative shell for the repo guards. Lists files, runs the pure checks,
// prints `path:line:col  message` and sets the exit code.
//
//   bun scripts/ci/cli.ts                  every guard over the repo (git-tracked + new files)
//   bun scripts/ci/cli.ts tokens brand     just those guards
//   bun scripts/ci/cli.ts tokens --root scripts/ci/__fixtures__/tokens/bad
//                                          a fixture tree instead of the repo (skips `lingui extract`)
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { z } from "zod";
import { checkBrand, isBrandChecked } from "./brand";
import {
  ALLOWLIST_PATH,
  checkIconImports,
  isIconChecked,
} from "./icon-imports";
import {
  listChangedFiles,
  listGitFiles,
  readOptional,
  readSourceFiles,
  walkFiles,
} from "./lib/files";
import { err, ok, type Result } from "./lib/result";
import { formatViolation, type Violation } from "./lib/violation";
import {
  checkCatalogDrift,
  checkCatalogs,
  findLinguiConfigs,
  isCatalog,
} from "./lingui";
import { checkTokens, isTokenChecked } from "./tokens";

const GuardName = z.enum(["tokens", "icon-imports", "brand", "lingui"]);
type GuardName = z.infer<typeof GuardName>;

interface Context {
  // False for fixture trees: they aren't a git checkout, so nothing is extracted.
  readonly isRepo: boolean;
  readonly paths: readonly string[];
  readonly root: string;
}

interface Outcome {
  readonly note?: string;
  readonly violations: readonly Violation[];
}

type Guard = (context: Context) => Result<Outcome, string>;

const read = (context: Context, include: (path: string) => boolean) =>
  readSourceFiles(context.root, context.paths.filter(include));

const runLinguiExtract = (
  root: string,
  config: string
): Result<void, string> => {
  const cwd = join(root, dirname(config));
  // Use the package's own CLI; never let `bun x` fetch one from the network.
  const bin = join(cwd, "node_modules", ".bin", "lingui");
  if (!existsSync(bin)) {
    return err(
      `${config}: @lingui/cli isn't installed in ${dirname(config)}; add it as a devDependency`
    );
  }
  try {
    execFileSync(bin, ["extract", "--clean", "--config", join(root, config)], {
      cwd,
      stdio: ["ignore", "ignore", "inherit"],
    });
    return ok(undefined);
  } catch (error) {
    return err(`${config}: lingui extract failed: ${String(error)}`);
  }
};

const lingui: Guard = (context) => {
  const configs = findLinguiConfigs(context.paths);
  if (configs.length === 0) {
    return ok({
      note: "skipped, no lingui config yet (ticket 006 adds packages/i18n)",
      violations: [],
    });
  }
  if (!context.isRepo) {
    return ok({ violations: checkCatalogs(read(context, isCatalog)) });
  }
  for (const config of configs) {
    const extracted = runLinguiExtract(context.root, config);
    if (!extracted.ok) {
      return extracted;
    }
  }
  const changed = listChangedFiles(context.root, ["*.po"]);
  if (!changed.ok) {
    return changed;
  }
  // Re-list: extract may have created catalogs that weren't there before.
  const paths = listGitFiles(context.root);
  if (!paths.ok) {
    return paths;
  }
  const catalogs = readSourceFiles(context.root, paths.value.filter(isCatalog));
  return ok({
    violations: [
      ...checkCatalogDrift(changed.value),
      ...checkCatalogs(catalogs),
    ],
  });
};

const GUARDS: Readonly<Record<GuardName, Guard>> = {
  brand: (context) =>
    ok({ violations: checkBrand(read(context, isBrandChecked)) }),
  "icon-imports": (context) =>
    ok({
      violations: checkIconImports(
        read(context, isIconChecked),
        readOptional(join(context.root, ALLOWLIST_PATH))
      ),
    }),
  lingui,
  tokens: (context) =>
    ok({ violations: checkTokens(read(context, isTokenChecked)) }),
};

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

const loadContext = (rootArg: string | undefined): Result<Context, string> => {
  if (rootArg !== undefined) {
    const root = resolve(rootArg);
    return existsSync(root)
      ? ok({ isRepo: false, paths: walkFiles(root), root })
      : err(`--root ${rootArg} does not exist`);
  }
  const paths = listGitFiles(REPO_ROOT);
  return paths.ok
    ? ok({ isRepo: true, paths: paths.value, root: REPO_ROOT })
    : paths;
};

const main = (argv: readonly string[]): number => {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    args: [...argv],
    options: { root: { type: "string" } },
  });
  const names = z.array(GuardName).safeParse(positionals);
  if (!names.success) {
    process.stderr.write(
      `Unknown guard. Choose from: ${GuardName.options.join(", ")}\n`
    );
    return 2;
  }
  const context = loadContext(values.root);
  if (!context.ok) {
    process.stderr.write(`${context.error}\n`);
    return 2;
  }

  const selected = names.data.length > 0 ? names.data : GuardName.options;
  let exitCode = 0;
  for (const name of selected) {
    const outcome = GUARDS[name](context.value);
    if (!outcome.ok) {
      process.stderr.write(`${name}: error: ${outcome.error}\n`);
      exitCode = Math.max(exitCode, 2);
      continue;
    }
    const { violations, note } = outcome.value;
    for (const violation of violations) {
      process.stderr.write(`${formatViolation(violation)}  [${name}]\n`);
    }
    if (violations.length > 0) {
      process.stderr.write(`${name}: ${violations.length} problem(s)\n`);
      exitCode = Math.max(exitCode, 1);
    } else {
      process.stdout.write(`${name}: ${note ?? "ok"}\n`);
    }
  }
  return exitCode;
};

process.exitCode = main(process.argv.slice(2));

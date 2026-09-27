import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  materialPackage,
  materialSymbols,
  materialWeights,
  renderVendoredWeight,
  vendoredFile,
  vendoredWeightSchema,
  vendorWeight,
} from "./material";
import type { Result } from "./registry";
import { materialVendorDir, srcDir } from "./sets";

// Regenerates `vendor/material-symbols/` from the `@material-symbols/svg-*`
// packages: the symbols `sets/material.ts` uses, in all 42 variants. Run by
// hand after mapping a new symbol (`bun run icons:vendor`) or to move to
// another release (`bun run icons:vendor 0.48.0`). The packages are ~165k
// files, so they're installed into a temporary directory for the run and
// never into the workspace.

function fail(problems: readonly string[]): never {
  for (const problem of problems) {
    console.error(`icons:vendor: ${problem}`);
  }
  process.exit(1);
}

/** The release the committed data came from, so a plain rerun keeps it. */
function vendoredVersion(): string | undefined {
  const file = join(materialVendorDir, vendoredFile(400));
  if (!existsSync(file)) {
    return;
  }
  const parsed = vendoredWeightSchema.safeParse(
    JSON.parse(readFileSync(file, "utf8"))
  );
  return parsed.success ? parsed.data.version : undefined;
}

const version = process.argv[2] ?? vendoredVersion();
if (!version) {
  fail(["no vendored data yet; pass a release, e.g. `icons:vendor 0.47.5`"]);
}

const symbols = materialSymbols(
  readFileSync(join(srcDir, "sets", "material.ts"), "utf8")
);

type Weight = (typeof materialWeights)[number];

// Installs the packages into `installDir` and writes the vendored files. Writes
// nothing unless every symbol is usable in every variant.
function vendor(release: string, installDir: string): Result<string, string[]> {
  writeFileSync(
    join(installDir, "package.json"),
    JSON.stringify({
      dependencies: Object.fromEntries(
        materialWeights.map((weight) => [materialPackage(weight), release])
      ),
      private: true,
    })
  );
  console.log(`icons:vendor: installing @material-symbols/svg-* ${release}…`);
  const install = spawnSync(
    process.execPath,
    ["install", "--ignore-scripts", "--no-save", "--silent"],
    { cwd: installDir, stdio: "inherit" }
  );
  if (install.status !== 0) {
    return { error: [`installing into ${installDir} failed`], ok: false };
  }

  const requireFrom = createRequire(join(installDir, "package.json"));
  const packageDir = (weight: Weight) =>
    dirname(requireFrom.resolve(`${materialPackage(weight)}/package.json`));

  const weights = materialWeights.map((weight) => {
    const dir = packageDir(weight);
    const result = vendorWeight(
      { version: release, weight },
      symbols,
      (file) => {
        const path = join(dir, file);
        return existsSync(path) ? readFileSync(path, "utf8") : undefined;
      }
    );
    return { result, weight };
  });
  const problems = weights.flatMap(({ result }) =>
    result.ok ? [] : result.error
  );
  if (problems.length > 0) {
    return { error: problems, ok: false };
  }

  mkdirSync(materialVendorDir, { recursive: true });
  for (const { result, weight } of weights) {
    if (result.ok) {
      writeFileSync(
        join(materialVendorDir, vendoredFile(weight)),
        renderVendoredWeight(result.value)
      );
    }
  }
  // Apache-2.0 §4: ship the licence and say what was taken and how.
  copyFileSync(
    join(packageDir(400), "LICENSE"),
    join(materialVendorDir, "LICENSE")
  );
  writeFileSync(join(materialVendorDir, "NOTICE"), notice(release));
  return {
    ok: true,
    value: `${symbols.length} symbols × ${weights.length * 6} variants from ${release} into ${materialVendorDir}`,
  };
}

function notice(release: string): string {
  return `Material Symbols
================

Material Symbols are by Google (https://github.com/google/material-design-icons)
and licensed under the Apache License, Version 2.0; see LICENSE in this
directory.

The svg-<weight>.json files hold the SVG path data of the symbols that
packages/icons/src/sets/material.ts uses, in the outlined, rounded and sharp
styles, unfilled and filled, taken from the npm packages
@material-symbols/svg-100 to svg-700, release ${release}
(https://github.com/marella/material-symbols, Apache-2.0). The paths are
unchanged; only the <path d="…"> value of each SVG is kept.

Regenerate with \`bun run icons:vendor\` in packages/icons (see its README).
`;
}

const scratch = mkdtempSync(join(tmpdir(), "material-symbols-"));
let outcome: Result<string, string[]>;
try {
  outcome = vendor(version, scratch);
} finally {
  rmSync(scratch, { force: true, recursive: true });
}
if (!outcome.ok) {
  fail(outcome.error);
}
console.log(`icons:vendor: ${outcome.value}`);

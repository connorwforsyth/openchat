import { describe, expect, it } from "vitest";

import { rewriteIconImports } from "./codemod";

const known = new Set(["ChevronRightIcon", "CheckIcon", "XIcon"]);

describe("rewriteIconImports", () => {
  it("points lucide-react at the web registry", () => {
    const { changed, code, unknown } = rewriteIconImports(
      'import { CheckIcon, ChevronRightIcon } from "lucide-react";\n',
      known
    );
    expect(changed).toBe(true);
    expect(code).toBe(
      'import { CheckIcon, ChevronRightIcon } from "@workspace/icons";\n'
    );
    expect(unknown).toEqual([]);
  });

  it("points lucide-react-native at the native entry, keeping quotes", () => {
    const { code } = rewriteIconImports(
      "import { XIcon } from 'lucide-react-native'",
      known
    );
    expect(code).toBe("import { XIcon } from '@workspace/icons/native'");
  });

  it("aliases unsuffixed names so call sites keep working", () => {
    const { code } = rewriteIconImports(
      'import { ChevronRight, Check as Tick } from "lucide-react";',
      known
    );
    expect(code).toBe(
      'import { ChevronRightIcon as ChevronRight, CheckIcon as Tick } from "@workspace/icons";'
    );
  });

  it("maps lucide's types to the registry's", () => {
    expect(
      rewriteIconImports(
        'import { type LucideIcon, XIcon } from "lucide-react";',
        known
      ).code
    ).toBe(
      'import { type Icon as LucideIcon, XIcon } from "@workspace/icons";'
    );
    expect(
      rewriteIconImports(
        'import type { LucideProps } from "lucide-react-native";',
        known
      ).code
    ).toBe(
      'import type { NativeIconProps as LucideProps } from "@workspace/icons/native";'
    );
  });

  it("keeps multi-line imports multi-line", () => {
    const { code } = rewriteIconImports(
      'import {\n  CheckIcon,\n  XIcon,\n} from "lucide-react";',
      known
    );
    expect(code).toBe(
      'import {\n  CheckIcon,\n  XIcon,\n} from "@workspace/icons";'
    );
  });

  it("rewrites re-exports, namespace, dynamic and require forms", () => {
    const source = [
      'export { XIcon } from "lucide-react";',
      'import * as Icons from "lucide-react";',
      'const lazy = import("lucide-react-native");',
      'const cjs = require("lucide-react");',
      'import "lucide-react";',
    ].join("\n");
    expect(rewriteIconImports(source, known).code).toBe(
      [
        'export { XIcon } from "@workspace/icons";',
        'import * as Icons from "@workspace/icons";',
        'const lazy = import("@workspace/icons/native");',
        'const cjs = require("@workspace/icons");',
        'import "@workspace/icons";',
      ].join("\n")
    );
  });

  it("reports names the registry doesn't map", () => {
    const { code, unknown } = rewriteIconImports(
      'import { CheckIcon, RocketIcon } from "lucide-react";',
      known
    );
    expect(code).toBe(
      'import { CheckIcon, RocketIcon } from "@workspace/icons";'
    );
    expect(unknown).toEqual(["RocketIcon"]);
  });

  it("leaves other modules and lookalike subpaths alone", () => {
    const source = [
      'import { Button } from "@workspace/ui/components/button";',
      'import { DynamicIcon } from "lucide-react/dynamic";',
      'import { X } from "not-lucide-react";',
    ].join("\n");
    const { changed, code } = rewriteIconImports(source, known);
    expect(changed).toBe(false);
    expect(code).toBe(source);
  });
});

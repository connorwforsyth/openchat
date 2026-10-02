import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  isLinkedWorktree,
  offsetFor,
  portFor,
  portLine,
  readCheckout,
  resolvePort,
} from "./dev-port";

const main = { linked: false, path: "/Users/dev/GitHub/app" };
const worktree = (name: string) => ({
  linked: true,
  path: `/Users/dev/GitHub/app-worktrees/${name}`,
});

describe("isLinkedWorktree", () => {
  it("recognises a linked worktree's gitdir pointer", () => {
    expect(
      isLinkedWorktree("gitdir: /Users/dev/GitHub/app/.git/worktrees/t-140\n")
    ).toBe(true);
    // A bare repository's common dir isn't named `.git`.
    expect(isLinkedWorktree("gitdir: /srv/app.git/worktrees/t-140")).toBe(true);
    expect(
      isLinkedWorktree("gitdir: C:\\repo\\.git\\worktrees\\t-140\r\n")
    ).toBe(true);
  });

  it("treats the main checkout, submodules and junk as not a worktree", () => {
    expect(isLinkedWorktree(undefined)).toBe(false);
    expect(isLinkedWorktree("gitdir: ../.git/modules/vendor")).toBe(false);
    expect(isLinkedWorktree("gitdir: /code/worktrees-app/.git")).toBe(false);
    expect(isLinkedWorktree("worktrees/t-140")).toBe(false);
    expect(isLinkedWorktree("gitdir:")).toBe(false);
  });
});

describe("portFor", () => {
  it("keeps the main checkout on today's ports", () => {
    expect(offsetFor(main)).toBe(0);
    expect(portFor(3000, main)).toBe(3000);
    expect(portFor(3100, main)).toBe(3100);
    expect(portFor(3184, main)).toBe(3184);
  });

  it("gives a worktree a stable port of its own", () => {
    const a = worktree("t-140");
    expect(portFor(3100, a)).toBe(portFor(3100, { ...a }));
    expect(portFor(3100, { ...a, path: `${a.path}/` })).toBe(portFor(3100, a));
    expect(portFor(3100, a)).not.toBe(3100);
    expect(portFor(3100, a)).not.toBe(portFor(3100, worktree("t-141")));
  });

  it("keeps worktree ports clear of the main checkout's and of blocked ports", () => {
    const blocked = new Set([4045, 4190, 5000, 5060, 5061, 5173, 5432, 6000]);
    const mainPorts = new Set([3000, 3100, 3184, 3190]);
    for (let index = 0; index < 500; index += 1) {
      const checkout = worktree(`t-${index}`);
      expect(offsetFor(checkout)).toBeGreaterThanOrEqual(1000);
      for (const base of [3000, 3100, 3184]) {
        const port = portFor(base, checkout);
        expect(port).toBeLessThan(10_000);
        expect(mainPorts.has(port)).toBe(false);
        expect(blocked.has(port)).toBe(false);
      }
    }
  });
});

describe("resolvePort", () => {
  const input = {
    base: 3100,
    checkout: worktree("t-140"),
    envName: "E2E_PORT",
  };

  it("lets an explicit variable win", () => {
    expect(resolvePort({ ...input, explicit: "4321" })).toEqual({
      ok: true,
      value: { port: 4321, source: "E2E_PORT" },
    });
  });

  it("falls back to the checkout's port when the variable is unset or blank", () => {
    for (const explicit of [undefined, "", "  "]) {
      const result = resolvePort({ ...input, explicit });
      expect(result).toEqual({
        ok: true,
        value: {
          port: portFor(3100, input.checkout),
          source: "this worktree; set E2E_PORT to choose",
        },
      });
    }
    expect(
      resolvePort({ ...input, checkout: main, explicit: undefined })
    ).toEqual({ ok: true, value: { port: 3100, source: "main checkout" } });
  });

  it("refuses a variable that isn't a port", () => {
    for (const explicit of ["abc", "0", "70000", "31.5"]) {
      expect(resolvePort({ ...input, explicit }).ok).toBe(false);
    }
  });
});

describe("readCheckout", () => {
  const dir = () => mkdtempSync(join(tmpdir(), "dev-port-"));

  it("reads a `.git` directory as the main checkout", () => {
    const root = dir();
    mkdirSync(join(root, ".git"));
    expect(readCheckout(root)).toEqual({ linked: false, path: root });
  });

  it("reads a `.git` file pointing into worktrees as a linked worktree", () => {
    const root = dir();
    writeFileSync(join(root, ".git"), "gitdir: /repo/.git/worktrees/t-1\n");
    expect(readCheckout(root)).toEqual({ linked: true, path: root });
  });

  it("reads no `.git` at all as the main checkout", () => {
    const root = dir();
    expect(readCheckout(root).linked).toBe(false);
  });
});

it("prints the port on one line", () => {
  expect(portLine("e2e", { port: 4123, source: "main checkout" })).toBe(
    "[e2e] http://localhost:4123 (main checkout)"
  );
});

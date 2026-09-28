import { spawn } from "node:child_process";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { connect } from "node:net";
import { join } from "node:path";

import type { Files, HttpGet, PortInUse, Runner } from "./system";

// The real ports, for `main.ts`. Kept thin: everything worth testing is in
// the pure modules that take these as arguments.

export const nodeFiles = (root: string): Files => ({
  read: async (path) => {
    try {
      return await readFile(join(root, path), "utf8");
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") {
        return;
      }
      throw cause;
    }
  },
  write: async (path, text, options) => {
    const target = join(root, path);
    await writeFile(target, text, {
      encoding: "utf8",
      mode: options?.secret ? 0o600 : 0o644,
    });
    // `mode` applies only when the file is created; tighten an existing one too.
    if (options?.secret) {
      await chmod(target, 0o600);
    }
  },
});

export const nodeRunner = (cwd: string): Runner => ({
  run: ({ args, command, env, inherit }) =>
    new Promise((resolve) => {
      const child = spawn(command, args, {
        cwd,
        env: { ...process.env, ...env },
        stdio: inherit ? "inherit" : ["ignore", "pipe", "ignore"],
      });
      let stdout = "";
      child.stdout?.setEncoding("utf8");
      child.stdout?.on("data", (chunk: string) => {
        stdout += chunk;
      });
      child.on("error", () => resolve({ code: 127, stdout }));
      child.on("close", (code) => resolve({ code: code ?? 1, stdout }));
    }),
});

const TIMEOUT_MS = 5000;

export const nodeHttpGet: HttpGet = async (url, headers) => {
  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  return { status: response.status, text: () => response.text() };
};

export const nodePortInUse: PortInUse = (port) =>
  new Promise((resolve) => {
    const socket = connect({ host: "127.0.0.1", port });
    const done = (inUse: boolean) => {
      socket.destroy();
      resolve(inUse);
    };
    socket.setTimeout(1000, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });

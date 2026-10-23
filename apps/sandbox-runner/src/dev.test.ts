import { describe, expect, it } from "vitest";

import { planDev } from "./dev";

describe("planDev", () => {
  it("starts the runner from compose when Docker answers and a token is set", () => {
    expect(planDev({ docker: true, port: "7071", token: "t" })).toEqual({
      args: [
        "compose",
        "--profile",
        "sandbox",
        "up",
        "-d",
        "--wait",
        "sandbox-runner",
      ],
      done: expect.stringContaining("http://localhost:7071"),
      kind: "start",
    });
  });

  it("says in one line, with the command, that Docker isn't running", () => {
    const plan = planDev({ docker: false, port: undefined, token: "t" });
    expect(plan).toEqual({
      kind: "skip",
      line: expect.stringContaining(
        "Docker isn't running (run code and Dot computers are off). Start Docker, then run: docker compose --profile sandbox up -d sandbox-runner"
      ),
    });
    expect(plan.kind === "skip" && plan.line.includes("\n")).toBe(false);
  });

  it("doesn't start a runner that would refuse every call", () => {
    expect(planDev({ docker: true, port: undefined, token: "" })).toEqual({
      kind: "skip",
      line: expect.stringContaining("bun run setup"),
    });
  });
});

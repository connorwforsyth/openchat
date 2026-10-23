import { describe, expect, it } from "vitest";

import { parseEnv } from "./env-file";
import { configExample, envExample, FAKE_KEYS, fakeRandom } from "./fixtures";
import { FILES } from "./plan";
import { CANCELLED, createScriptedPrompter, type Script } from "./prompter";
import { runSetup } from "./setup";
import { createMemoryFiles, type MemoryFiles } from "./system";

// The wizard end to end: scripted answers in, files out, through the same
// Prompter and Files ports the terminal uses.

const NOT_PICKED = /isn't one of the providers you picked/;

const checkout = (extra: Record<string, string> = {}) =>
  createMemoryFiles({
    [FILES.configExample]: configExample,
    [FILES.envExample]: envExample,
    ...extra,
  });

const run = async (files: MemoryFiles, script: Script) => {
  const prompter = createScriptedPrompter(script);
  const result = await runSetup({ files, prompter, random: fakeRandom() });
  return { prompter, result };
};

/** The loop's hand-made demo setup, as answers typed into the wizard. */
const demoScript: Script = {
  egress: "open",
  iconStyle: "rounded",
  icons: "material",
  "key.anthropic": FAKE_KEYS.anthropic,
  mode: "docker",
  providers: ["anthropic"],
  sandbox: "docker",
};

describe("bun run setup", () => {
  it("writes all three files on a first run without asking to overwrite", async () => {
    const files = checkout();
    const { prompter, result } = await run(files, demoScript);

    expect(result).toEqual({
      ok: true,
      value: [FILES.env, FILES.config, FILES.override],
    });
    expect(prompter.asked.some((id) => id.startsWith("overwrite:"))).toBe(
      false
    );
    const env = parseEnv(files.files.get(FILES.env) ?? "");
    expect(env.ANTHROPIC_API_KEY).toBe(FAKE_KEYS.anthropic);
    expect(env.SANDBOX_EGRESS).toBe("");
    expect(files.secretPaths).toEqual(new Set([FILES.env]));
  });

  it("asks exactly the questions each answer needs", async () => {
    const { prompter } = await run(checkout(), demoScript);
    expect(prompter.asked).toEqual([
      "mode",
      "providers",
      "key.anthropic",
      "model.strong",
      "model.fast",
      "signup",
      "brandName",
      "sandbox",
      "egress",
      "services",
      "icons",
      "iconStyle",
    ]);
  });

  it("never shows a key it was given", async () => {
    const { prompter } = await run(checkout(), {
      ...demoScript,
      "compatible.url": "http://host.docker.internal:4000/v1",
      "key.compatible": FAKE_KEYS.gateway,
      "key.openai": FAKE_KEYS.openai,
      providers: ["anthropic", "openai", "compatible"],
    });
    const shown = prompter.shown.join("\n");
    for (const key of Object.values(FAKE_KEYS)) {
      expect(shown).not.toContain(key);
    }
    expect(shown).toContain(
      "ANTHROPIC_API_KEY, OPENAI_API_KEY, OLLAMA_API_KEY saved in .env"
    );
  });

  it("re-runs from the files: Enter everywhere changes nothing", async () => {
    const files = checkout();
    await run(files, demoScript);
    const before = new Map(files.files);

    const { prompter, result } = await run(files, {});
    expect(result).toEqual({ ok: true, value: [] });
    expect(files.files).toEqual(before);
    expect(prompter.shown).toContain(
      "Anthropic API key (saved in .env; Enter keeps it)"
    );
  });

  it("asks before overwriting, and leaves a declined file alone", async () => {
    const files = checkout();
    await run(files, demoScript);
    const config = files.files.get(FILES.config);

    const { prompter, result } = await run(files, {
      "overwrite:app.config.yaml": false,
      signup: "open",
    });
    expect(prompter.asked).toContain("overwrite:app.config.yaml");
    expect(prompter.shown).toContain("Update app.config.yaml? (auth)");
    expect(result).toEqual({ ok: true, value: [] });
    expect(files.files.get(FILES.config)).toBe(config);
  });

  it("names the changed variables, not their values, when asking about .env", async () => {
    const files = checkout();
    await run(files, demoScript);
    const { prompter } = await run(files, {
      "key.anthropic": "another-fake-key-placeholder",
    });
    expect(prompter.shown).toContain("Update .env? (ANTHROPIC_API_KEY)");
    expect(prompter.shown.join("\n")).not.toContain("another-fake-key");
  });

  it("offers to move ICON_* out of an older .env, naming them without values (130)", async () => {
    const files = checkout();
    await run(files, demoScript);
    const env = files.files.get(FILES.env) ?? "";
    files.files.set(
      FILES.env,
      `${env}ICON_SET=phosphor-value-placeholder\nICON_STYLE=sharp\n`
    );

    const { prompter, result } = await run(files, {});
    expect(prompter.asked.indexOf("iconEnv")).toBe(
      prompter.asked.indexOf("icons") - 1
    );
    expect(prompter.shown).toContain(
      ".env sets ICON_SET, ICON_STYLE, which app.config.yaml's icons block now overrides. Remove them from .env?"
    );
    expect(prompter.shown).toContain("Update .env? (ICON_SET, ICON_STYLE)");
    const shown = prompter.shown.join("\n");
    expect(shown).not.toContain("phosphor-value-placeholder");
    expect(shown).not.toContain(FAKE_KEYS.anthropic);
    expect(result).toEqual({ ok: true, value: [FILES.env] });
    expect(files.files.get(FILES.env)).toBe(env);
  });

  it("leaves ICON_* in .env when the move is declined", async () => {
    const files = checkout();
    await run(files, demoScript);
    const older = `${files.files.get(FILES.env)}ICON_SET=material\n`;
    files.files.set(FILES.env, older);

    const { result } = await run(files, { iconEnv: false });
    expect(result).toEqual({ ok: true, value: [] });
    expect(files.files.get(FILES.env)).toBe(older);
  });

  it("doesn't ask about ICON_* when .env has none", async () => {
    const files = checkout();
    await run(files, demoScript);
    const { prompter } = await run(files, {});
    expect(prompter.asked).not.toContain("iconEnv");
  });

  it("writes nothing when cancelled", async () => {
    const files = checkout();
    const { result } = await run(files, {
      ...demoScript,
      sandbox: CANCELLED,
    });
    expect(result).toEqual({ error: { type: "cancelled" }, ok: false });
    expect([...files.files.keys()].sort()).toEqual(
      [FILES.configExample, FILES.envExample].sort()
    );
  });

  it("writes nothing when the config would be invalid, and says why", async () => {
    const files = checkout({
      [FILES.config]: "limits: { requestsPerMinute: 0 }\n",
    });
    const { prompter, result } = await run(files, demoScript);
    expect(result.ok).toBe(false);
    expect(prompter.shown.join("\n")).toContain("limits.requestsPerMinute");
    expect(files.files.has(FILES.env)).toBe(false);
  });

  it("needs a checkout", async () => {
    const { result } = await run(createMemoryFiles(), demoScript);
    expect(result).toEqual({ error: { type: "not-a-checkout" }, ok: false });
  });

  it("offers local-mode questions and defaults", async () => {
    const files = checkout();
    const { prompter } = await run(files, {
      database: "pglite",
      domains: "Example.com, example.org",
      mode: "local",
      "model.fast": "",
      "model.strong": "ollama:llama3.2",
      providers: ["compatible"],
      signup: "domain",
    });
    expect(prompter.asked).toEqual([
      "mode",
      "database",
      "providers",
      "compatible.id",
      "compatible.url",
      "key.compatible",
      "model.strong",
      "model.fast",
      "signup",
      "domains",
      "brandName",
      "sandbox",
      "services",
      "icons",
    ]);
    expect(files.files.has(FILES.override)).toBe(false);
    expect(files.files.get(FILES.config)).toContain(
      "domains: [ example.com, example.org ]"
    );
  });

  it("rejects a model from a provider that wasn't picked", async () => {
    await expect(
      run(checkout(), { ...demoScript, "model.strong": "openai:gpt-5" })
    ).rejects.toThrow(NOT_PICKED);
  });
});

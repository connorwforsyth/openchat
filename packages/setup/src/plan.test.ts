import { parseConfig } from "@workspace/config/parse";
import { describe, expect, it } from "vitest";

import type { Answers } from "./answers";
import { LEGACY_DOCKER_STORAGE_PATH, STORAGE_PATH } from "./config-file";
import { type CurrentFiles, readDefaults } from "./current";
import { parseEnv } from "./env-file";
import {
  demoAnswers,
  everythingAnswers,
  FAKE_KEYS,
  fakeRandom,
  firstRun,
  localAnswers,
} from "./fixtures";
import { FILES, type FileChange, planChanges } from "./plan";

const plan = (files: CurrentFiles, answers: Answers) => {
  const result = planChanges(files, answers, fakeRandom());
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.value;
};

const byPath = (changes: readonly FileChange[]) =>
  Object.fromEntries(changes.map((change) => [change.path, change.after]));

/** The files after applying a plan on top of `files`. */
const apply = (files: CurrentFiles, changes: readonly FileChange[]) => {
  const after = byPath(changes);
  return {
    ...files,
    config: after[FILES.config] ?? files.config,
    env: after[FILES.env] ?? files.env,
    override: after[FILES.override] ?? files.override,
  };
};

describe.each([
  ["the 026 demo (Docker, Anthropic, Docker sandboxes, Material)", demoAnswers],
  ["local dev on PGlite with Ollama and every service", localAnswers],
  ["Docker with every provider and a host gateway", everythingAnswers],
])("first run: %s", (_name, answers) => {
  const files = byPath(plan(firstRun, answers));

  it("writes .env", () => {
    expect(files[FILES.env]).toMatchSnapshot();
  });

  it("writes app.config.yaml, which the app accepts", () => {
    const config = files[FILES.config] ?? "";
    expect(config).toMatchSnapshot();
    expect(parseConfig(config, parseEnv(files[FILES.env] ?? "")).ok).toBe(true);
  });

  it("writes docker-compose.override.yml only for Docker", () => {
    expect(files[FILES.override]).toMatchSnapshot();
    expect(files[FILES.override] !== undefined).toBe(answers.mode === "docker");
  });

  it("puts keys in .env and nowhere else", () => {
    for (const key of Object.values(FAKE_KEYS)) {
      expect(files[FILES.config]).not.toContain(key);
      expect(files[FILES.override] ?? "").not.toContain(key);
    }
    const env = parseEnv(files[FILES.env] ?? "");
    for (const [name, value] of Object.entries(answers.keys)) {
      expect(env[name]).toBe(value);
    }
  });
});

describe("the demo's answers", () => {
  const files = apply(firstRun, plan(firstRun, demoAnswers));
  const env = parseEnv(files.env ?? "");

  it("reproduce what was done by hand", () => {
    expect(env).toMatchObject({
      SANDBOX_EGRESS: "open",
      SANDBOX_RUNNER_TOKEN: "fake-random-1",
    });
    // The icon set goes in the yaml, never .env (130).
    expect(Object.keys(env).filter((name) => name.startsWith("ICON_"))).toEqual(
      []
    );
    expect(files.config).toContain("icons: { set: material, style: rounded }");
    expect(files.config).toContain("  default: docker");
    expect(files.override).toContain("CONFIG_PATH: /config/app.config.yaml");
    expect(files.override).toContain(
      "./app.config.yaml:/config/app.config.yaml:ro"
    );
  });
});

describe("re-running", () => {
  const first = apply(firstRun, plan(firstRun, demoAnswers));

  it("reads the answers back as the defaults, keys as names only", () => {
    const { keys, ...rest } = demoAnswers;
    expect(readDefaults(first)).toEqual({
      ...rest,
      iconEnv: { ignored: true, names: [] },
      keysSet: Object.keys(keys),
    });
  });

  it("changes nothing when the answers are the same", () => {
    expect(plan(first, { ...demoAnswers, keys: {} })).toEqual([]);
  });

  it("keeps the generated token rather than making a new one", () => {
    const again = apply(
      first,
      plan(first, { ...demoAnswers, egress: "none", keys: {} })
    );
    expect(parseEnv(again.env ?? "")).toMatchObject({
      ANTHROPIC_API_KEY: FAKE_KEYS.anthropic,
      SANDBOX_EGRESS: "none",
      SANDBOX_RUNNER_TOKEN: "fake-random-1",
    });
  });

  it("keeps hand edits in every file", () => {
    const edited: CurrentFiles = {
      ...first,
      config: `${first.config}# my note\n`.replace(
        "aliases:",
        "aliases:\n    mine: anthropic:claude-sonnet-4-5"
      ),
      env: `${first.env}MY_OWN=thing\n`,
      override: `${first.override}  postgres:\n    ports: ["127.0.0.1:5433:5432"]\n`,
    };
    const again = apply(
      edited,
      plan(edited, { ...demoAnswers, keys: {}, signup: "open" })
    );
    expect(again.config).toContain("# my note");
    expect(again.config).toContain("mine: anthropic:claude-sonnet-4-5");
    expect(again.config).toContain("signup: open");
    expect(parseEnv(again.env ?? "").MY_OWN).toBe("thing");
    expect(again.override).toBe(edited.override);
  });

  it("drops a provider, and every model that pointed at it", () => {
    const switched = apply(
      first,
      plan(first, {
        ...demoAnswers,
        compatible: { baseURL: "http://localhost:11434/v1", id: "ollama" },
        fastModel: null,
        keys: {},
        providers: ["compatible"],
        strongModel: "ollama:qwen3",
      })
    );
    const config = switched.config ?? "";
    expect(config).not.toContain("anthropic:");
    // A description goes with its alias; one whose alias stays, stays.
    expect(config).not.toContain("Quick everyday answers");
    expect(config).toContain("strong: Hard problems and long documents");
    expect(parseConfig(config, parseEnv(switched.env ?? "")).ok).toBe(true);
    // The key stays in .env: deselecting a provider doesn't delete a secret.
    expect(parseEnv(switched.env ?? "").ANTHROPIC_API_KEY).toBe(
      FAKE_KEYS.anthropic
    );
  });

  it("drops a rating whose model has gone, keeping the rest (099)", () => {
    const rated: CurrentFiles = {
      ...first,
      config: first.config?.replace(
        "aliases:",
        "ratings:\n    fast: { speed: 5 }\n    strong: { intelligence: 5 }\n  aliases:"
      ),
    };
    expect(parseConfig(rated.config ?? "", parseEnv(first.env ?? "")).ok).toBe(
      true
    );
    const switched = apply(
      rated,
      plan(rated, {
        ...demoAnswers,
        compatible: { baseURL: "http://localhost:11434/v1", id: "ollama" },
        fastModel: null,
        keys: {},
        providers: ["compatible"],
        strongModel: "ollama:qwen3",
      })
    );
    const config = switched.config ?? "";
    expect(config).not.toContain("speed: 5");
    expect(config).toContain("intelligence: 5");
    expect(parseConfig(config, parseEnv(switched.env ?? "")).ok).toBe(true);
  });

  it("switches the database, and moves the old Docker storage path back for local mode", () => {
    // What setup wrote for Docker before the image linked ./.data into its volume.
    const legacy: CurrentFiles = {
      ...first,
      config: first.config?.replace(STORAGE_PATH, LEGACY_DOCKER_STORAGE_PATH),
    };
    expect(legacy.config).toContain(`path: ${LEGACY_DOCKER_STORAGE_PATH}`);
    const local = apply(
      legacy,
      plan(legacy, {
        ...demoAnswers,
        database: "pglite",
        keys: {},
        mode: "local",
      })
    );
    expect(local.config).toContain(`path: ${STORAGE_PATH}`);
    expect(parseEnv(local.env ?? "").DATABASE_URL).toBe("");
    expect(readDefaults({ ...local, override: undefined }).mode).toBe("local");
    // In the image both are the same directory in the volume: nothing to move.
    expect(plan(legacy, { ...demoAnswers, keys: {} })).toEqual([]);
  });
});

const ICONS_KEY = /^icons:/m;
const ICONS_LINE = /^icons:.*\n/m;

describe("an older .env with ICON_* (130)", () => {
  const first = apply(firstRun, plan(firstRun, everythingAnswers));
  const secretLine = `OPENAI_API_KEY=${FAKE_KEYS.openai}`;

  it("ignores them when the config has an icons block, and offers to remove them", () => {
    // Connor's case: Phosphor in the yaml, Material left behind in .env.
    const older: CurrentFiles = {
      ...first,
      env: `${first.env}ICON_SET=material\n`,
    };
    const defaults = readDefaults(older);
    expect(defaults.icons).toEqual({ set: "phosphor", style: null });
    expect(defaults.iconEnv).toEqual({ ignored: true, names: ["ICON_SET"] });

    const moved = apply(
      older,
      plan(older, { ...everythingAnswers, keys: {}, moveIconEnv: true })
    );
    expect(moved.env).toBe(first.env);
    expect(moved.env).toContain(secretLine);
    expect(moved.config).toBe(first.config);

    // Declined: .env is left exactly as it was.
    expect(
      plan(older, { ...everythingAnswers, keys: {}, moveIconEnv: false })
    ).toEqual([]);
  });

  it("moves them into the icons block when the config has none", () => {
    const older: CurrentFiles = {
      ...first,
      config: first.config?.replace(ICONS_LINE, ""),
      env: `${first.env}ICON_SET=Material\nICON_STYLE=sharp\nICON_WEIGHT=300\nICON_FILL=true\n`,
    };
    expect(older.config).not.toMatch(ICONS_KEY);
    const defaults = readDefaults(older);
    expect(defaults.icons).toEqual({
      fill: true,
      set: "material",
      style: "sharp",
      weight: 300,
    });
    expect(defaults.iconEnv).toEqual({
      ignored: false,
      names: ["ICON_SET", "ICON_STYLE", "ICON_WEIGHT", "ICON_FILL"],
    });

    const moved = apply(
      older,
      plan(older, {
        ...everythingAnswers,
        icons: defaults.icons,
        keys: {},
        moveIconEnv: true,
      })
    );
    const env = parseEnv(moved.env ?? "");
    expect(Object.keys(env).filter((name) => name.startsWith("ICON_"))).toEqual(
      []
    );
    expect(moved.env).toContain(secretLine);
    expect(moved.config).toContain(
      "icons: { set: material, style: sharp, weight: 300, fill: true }"
    );
    expect(parseConfig(moved.config ?? "", env).ok).toBe(true);
    // What was moved reads back the same, with nothing left to offer.
    expect(readDefaults(moved).icons).toEqual(defaults.icons);
    expect(readDefaults(moved).iconEnv).toEqual({ ignored: true, names: [] });
  });
});

describe("validation", () => {
  it("refuses a plan the app couldn't boot with, and says where", () => {
    const broken: CurrentFiles = {
      ...firstRun,
      config: "limits: { requestsPerMinute: 0 }\n",
    };
    const result = planChanges(broken, demoAnswers, fakeRandom());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain("limits.requestsPerMinute");
    }
  });
});

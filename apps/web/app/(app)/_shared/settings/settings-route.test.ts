import { defaultTerms, resolveTerms } from "@workspace/config/terms";
import { describe, expect, it } from "vitest";

import { routes } from "@/lib/routes";

import {
  closeSettings,
  openSettings,
  settingsRouteFromPath as routeFor,
  type SettingsHistory,
  selectSettingsSection,
  settingsRedirect,
} from "./settings-route";

const terms = defaultTerms;
const plugins = resolveTerms({
  mcp: { label: "Plugins", locales: {}, singular: "Plugin", slug: "plugins" },
});
const settingsRouteFromPath = (path: string) => routeFor(path, terms);

/** An in-memory history: a stack of entries and an index. */
const fakeHistory = (path: string, state: unknown = null) => {
  const entries: { state: unknown; url: string }[] = [{ state, url: path }];
  let index = 0;
  const history: SettingsHistory & { readonly url: () => string } = {
    back: () => {
      index = Math.max(0, index - 1);
    },
    pushState: (data, _unused, url) => {
      entries.splice(index + 1);
      entries.push({ state: data, url });
      index = entries.length - 1;
    },
    replaceState: (data, _unused, url) => {
      entries[index] = { state: data, url };
    },
    get state() {
      return entries[index]?.state;
    },
    url: () => entries[index]?.url ?? "",
  };
  return history;
};

describe("settingsRouteFromPath", () => {
  it("reads the section from the address", () => {
    expect(settingsRouteFromPath("/settings/keys")).toBe("keys");
    expect(settingsRouteFromPath("/settings/mcp")).toBe("mcp");
    expect(settingsRouteFromPath("/settings/appearance/")).toBe("appearance");
    expect(settingsRouteFromPath("/settings")).toBe("index");
  });

  it("is closed anywhere else, and for a section that doesn't exist", () => {
    expect(settingsRouteFromPath("/")).toBeNull();
    expect(settingsRouteFromPath("/c/abc")).toBeNull();
    expect(settingsRouteFromPath("/settings/nope")).toBeNull();
    expect(settingsRouteFromPath("/settingsx")).toBeNull();
    expect(settingsRouteFromPath("/settings/keys/extra")).toBeNull();
  });
});

describe("configured slugs (191)", () => {
  it("builds every settings address through one helper", () => {
    expect(routes.settings(terms)).toBe("/settings");
    expect(routes.settings(terms, "mcp")).toBe("/settings/mcp");
    expect(routes.settings(plugins, "mcp")).toBe("/settings/plugins");
    expect(routes.settings(plugins, "keys")).toBe("/settings/keys");
  });

  it("opens the section at its configured slug", () => {
    expect(routeFor("/settings/plugins", plugins)).toBe("mcp");
    expect(routeFor("/settings/plugins", terms)).toBeNull();
    expect(settingsRedirect("/settings/plugins", plugins)).toBeNull();
  });

  it("redirects the old addresses to the configured slug", () => {
    expect(settingsRedirect("/settings/connectors", terms)).toBe(
      "/settings/mcp"
    );
    expect(settingsRedirect("/settings/connectors", plugins)).toBe(
      "/settings/plugins"
    );
    expect(settingsRedirect("/settings/mcp", plugins)).toBe(
      "/settings/plugins"
    );
    expect(settingsRedirect("/settings/mcp", terms)).toBeNull();
    expect(settingsRedirect("/settings/nope", terms)).toBeNull();
    expect(settingsRedirect("/settings", terms)).toBeNull();
    // Until the redirect lands, the old address still shows the section.
    expect(routeFor("/settings/connectors", plugins)).toBe("mcp");
  });

  it("opens and switches to the configured slug", () => {
    const history = fakeHistory("/c/1");
    openSettings(history, "/c/1", plugins, "mcp");
    expect(history.url()).toBe("/settings/plugins");
    selectSettingsSection(history, plugins, "keys");
    expect(history.url()).toBe("/settings/keys");
  });
});

describe("opening and closing", () => {
  it("opens over the page and goes back to it on close", () => {
    const history = fakeHistory("/c/123");
    openSettings(history, "/c/123", terms, "memory");
    expect(history.url()).toBe("/settings/memory");
    selectSettingsSection(history, terms, "keys");
    expect(history.url()).toBe("/settings/keys");
    closeSettings(history, "/");
    expect(history.url()).toBe("/c/123");
  });

  it("switches section instead of stacking when already open", () => {
    const history = fakeHistory("/library");
    openSettings(history, "/library", terms);
    openSettings(history, "/settings", terms, "shortcuts");
    expect(history.url()).toBe("/settings/shortcuts");
    closeSettings(history, "/");
    expect(history.url()).toBe("/library");
  });

  it("hands the router none of its own state when switching section", () => {
    const history = fakeHistory("/settings", { __NA: true });
    selectSettingsSection(history, terms, "memory");
    expect(history.url()).toBe("/settings/memory");
    expect(history.state).toBeNull();
  });

  it("a hard load of the address closes onto the new chat", () => {
    const history = fakeHistory("/settings/keys");
    closeSettings(history, "/");
    expect(history.url()).toBe("/");
  });
});

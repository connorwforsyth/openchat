import { fixtureId, org, userAda } from "@workspace/contract/fixtures";
import type { Me, PublicConfig } from "@workspace/contract/schemas/meta";
import { vi } from "vitest";

import type { AppFrameValue } from "./app-frame";

// A hand-built app frame for tests that render pages without <AppFrame>.

export const testMe: Me = {
  orgs: [org],
  persistClientCache: true,
  personalOrgId: fixtureId("org", 9),
  teams: [],
  user: {
    email: "ada@example.test",
    id: userAda.id,
    image: null,
    isAdmin: false,
    locale: null,
    name: userAda.name,
  },
};

const config: PublicConfig = {
  artifacts: { siteOrigins: [] },
  auth: { providers: [], signup: "invite" },
  brand: { faviconUrl: null, logoUrl: null, name: "Test Chat" },
  features: {
    fileUploads: true,
    importers: false,
    memory: true,
    publicLinks: false,
    sandboxes: false,
    webSearch: false,
  },
  limits: { memoryMaxChars: 4000, uploadMaxMb: 20 },
  policies: { chatContexts: ["personal", "team", "org"] },
  sandbox: { default: null, providers: [] },
};

export const testFrame = (
  overrides: Partial<AppFrameValue> = {}
): AppFrameValue => ({
  chat: {
    draftContext: { type: "personal" },
    paletteContext: undefined,
    setDraftContext: vi.fn(),
    setPaletteContext: vi.fn(),
    setTarget: vi.fn(),
    target: null,
  },
  config,
  layout: {
    layout: { panel: null, panelWidth: 400, sidebarOpen: true },
    setPanel: vi.fn(),
    setPanelWidth: vi.fn(),
    togglePanel: vi.fn(),
    toggleSidebar: vi.fn(),
  },
  me: testMe,
  openNewOrg: vi.fn(),
  openPalette: vi.fn(),
  openSettings: vi.fn(),
  paletteOpen: false,
  setPaletteOpen: vi.fn(),
  setSidebarLayout: vi.fn(),
  setTheme: vi.fn(),
  sidebarLayout: "rail",
  signOut: vi.fn(),
  theme: "system",
  ...overrides,
});

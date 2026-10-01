import { describe, expect, it } from "vitest";

import type { Identity } from "./brand";
import {
  builderConfig,
  type PackageOptions,
  packageOptionsFromEnv,
} from "./builder-config";

const identity: Identity = {
  appId: "com.acme.chat",
  executableName: "acme-chat",
  name: "Acme Chat",
  urlScheme: "acme",
};
const unsigned: PackageOptions = {
  autoUpdate: null,
  macSigning: "none",
  winSigning: false,
};

const config = (
  options: PackageOptions = unsigned,
  overrides: Partial<Identity> = {}
) =>
  builderConfig({
    electronVersion: "44.5.1",
    identity: { ...identity, ...overrides },
    options,
  });

describe("builderConfig", () => {
  it("names and identifies the app from the brand", () => {
    expect(config()).toMatchObject({
      appId: "com.acme.chat",
      electronVersion: "44.5.1",
      productName: "Acme Chat",
      protocols: [{ name: "Acme Chat", schemes: ["acme"] }],
    });
    expect(config().linux?.executableName).toBe("acme-chat");
  });

  it("registers no URL scheme without one", () => {
    expect(config(unsigned, { urlScheme: null }).protocols).toBeUndefined();
  });

  it("uses the generated icons on every platform", () => {
    const { linux, mac, win } = config();
    expect(mac?.icon).toBe(".brand/icon.icns");
    expect(win?.icon).toBe(".brand/icon.ico");
    expect(linux?.icon).toBe(".brand/png");
    expect(config().extraResources).toEqual([
      { filter: ["*.png"], from: ".brand/tray", to: "brand" },
    ]);
  });

  it("declares dmg and zip for both Mac arches, nsis and AppImage", () => {
    const { linux, mac, win } = config();
    expect(mac?.target).toEqual([
      { arch: ["arm64", "x64"], target: "dmg" },
      { arch: ["arm64", "x64"], target: "zip" },
    ]);
    expect(win?.target).toEqual([{ arch: ["x64", "arm64"], target: "nsis" }]);
    expect(linux?.target).toEqual([
      { arch: ["x64", "arm64"], target: "AppImage" },
    ]);
  });

  it("flips the fuses and re-signs ad hoc when unsigned", () => {
    expect(config().electronFuses).toEqual({
      enableEmbeddedAsarIntegrityValidation: true,
      enableNodeCliInspectArguments: false,
      enableNodeOptionsEnvironmentVariable: false,
      onlyLoadAppFromAsar: true,
      resetAdHocDarwinSignature: true,
      runAsNode: false,
    });
    expect(config().mac).toMatchObject({
      hardenedRuntime: false,
      identity: null,
      notarize: false,
    });
  });

  it("signs with the hardened runtime when an identity is given", () => {
    const signed = config({ ...unsigned, macSigning: "sign-and-notarize" });
    expect(signed.mac).toMatchObject({
      entitlements: "build/entitlements.mac.plist",
      hardenedRuntime: true,
      identity: undefined,
      notarize: true,
    });
    expect(signed.electronFuses?.resetAdHocDarwinSignature).toBe(false);
  });

  it("ships only the stage, without node_modules", () => {
    expect(config().directories?.app).toBe("dist/app");
    expect(config().files).toEqual(["**/*", "!**/node_modules/**"]);
  });

  it("has no update feed unless auto-update is on", () => {
    expect(config().publish).toBeNull();
    expect(
      config({ ...unsigned, autoUpdate: { owner: "acme", repo: "chat" } })
        .publish
    ).toEqual([
      {
        owner: "acme",
        provider: "github",
        releaseType: "release",
        repo: "chat",
      },
    ]);
  });
});

describe("packageOptionsFromEnv", () => {
  it("is unsigned with no updates by default", () => {
    expect(packageOptionsFromEnv({})).toEqual({ ok: true, value: unsigned });
  });

  it("turns on auto-update with a repository", () => {
    expect(
      packageOptionsFromEnv({
        DESKTOP_AUTO_UPDATE: "1",
        DESKTOP_UPDATE_REPO: "acme/chat-desktop",
      })
    ).toEqual({
      ok: true,
      value: {
        ...unsigned,
        autoUpdate: { owner: "acme", repo: "chat-desktop" },
      },
    });
  });

  it("refuses auto-update without a repository", () => {
    expect(packageOptionsFromEnv({ DESKTOP_AUTO_UPDATE: "1" }).ok).toBe(false);
  });

  it("refuses a malformed switch", () => {
    expect(packageOptionsFromEnv({ DESKTOP_AUTO_UPDATE: "yes" }).ok).toBe(
      false
    );
    expect(packageOptionsFromEnv({ DESKTOP_UPDATE_REPO: "nope" }).ok).toBe(
      false
    );
  });

  it("signs when an identity is set, and notarises with Apple's credentials", () => {
    expect(packageOptionsFromEnv({ CSC_LINK: "x" })).toMatchObject({
      value: { macSigning: "sign", winSigning: true },
    });
    expect(
      packageOptionsFromEnv({
        APPLE_API_ISSUER: "x",
        APPLE_API_KEY: "x",
        APPLE_API_KEY_ID: "x",
        CSC_NAME: "x",
      })
    ).toMatchObject({ value: { macSigning: "sign-and-notarize" } });
  });

  it("doesn't notarise with an incomplete set", () => {
    expect(
      packageOptionsFromEnv({ APPLE_ID: "x", CSC_NAME: "x" })
    ).toMatchObject({ value: { macSigning: "sign" } });
  });
});

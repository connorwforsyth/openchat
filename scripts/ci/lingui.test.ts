import { describe, expect, it } from "vitest";
import { loadFixture, locations } from "./lib/fixtures";
import {
  checkCatalog,
  checkCatalogDrift,
  checkCatalogs,
  findLinguiConfigs,
} from "./lingui";

describe("lingui guard", () => {
  it("flags missing translations, plural forms included, and unused keys", () => {
    const violations = checkCatalogs(loadFixture("lingui", "bad"));
    expect(locations(violations)).toEqual([
      "packages/i18n/locales/en/messages.po:8",
      "packages/i18n/locales/fr/messages.po:6",
      "packages/i18n/locales/fr/messages.po:9",
    ]);
    expect(violations.map((v) => v.message)).toEqual([
      "unused key: run `lingui extract --clean` and commit",
      'missing translation for "Hello"',
      'missing translation for "One file"',
    ]);
  });

  it("passes complete catalogs, including wrapped and ICU messages", () => {
    expect(checkCatalogs(loadFixture("lingui", "good"))).toEqual([]);
  });

  it("treats an entry with no msgstr at all as missing", () => {
    const content = 'msgid ""\nmsgstr ""\n\nmsgid "Orphan"\n';
    expect(checkCatalog({ content, path: "a.po" })).toHaveLength(1);
  });

  it("flags catalogs that extract changed", () => {
    const changed = [
      "packages/i18n/locales/en/messages.po",
      "packages/i18n/src/index.ts",
    ];
    expect(locations(checkCatalogDrift(changed))).toEqual([
      "packages/i18n/locales/en/messages.po:1",
    ]);
  });

  it("finds lingui configs, ignoring fixtures and dependencies", () => {
    expect(
      findLinguiConfigs([
        "packages/i18n/lingui.config.ts",
        "apps/web/.linguirc",
        "packages/ui/src/lingui.ts",
        "node_modules/x/lingui.config.js",
        "scripts/ci/__fixtures__/lingui/bad/packages/i18n/lingui.config.ts",
      ])
    ).toEqual(["packages/i18n/lingui.config.ts", "apps/web/.linguirc"]);
  });

  it("is a no-op until a lingui config exists", () => {
    expect(findLinguiConfigs(["apps/web/app/page.tsx"])).toEqual([]);
  });
});

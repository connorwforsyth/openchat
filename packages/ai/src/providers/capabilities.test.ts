import type { ProviderConfig } from "@workspace/config/schema";
import { describe, expect, it } from "vitest";

import { acceptsFile, providerCapabilities } from "./capabilities";

const provider = (
  type: ProviderConfig["type"],
  options: Record<string, string> = {}
): ProviderConfig => ({ headers: {}, models: [], options, type });

describe("providerCapabilities", () => {
  it("native providers read images and PDFs", () => {
    for (const type of ["anthropic", "openai", "google"] as const) {
      expect(providerCapabilities(provider(type))).toEqual([
        "tools",
        "vision",
        "files",
      ]);
    }
  });

  it("an openai-compatible server reads neither unless it says so", () => {
    expect(providerCapabilities(provider("openai-compatible"))).toEqual([
      "tools",
    ]);
    expect(
      providerCapabilities(
        provider("openai-compatible", {
          capabilities: "tools, vision nonsense",
        })
      )
    ).toEqual(["tools", "vision"]);
  });

  it("options.capabilities overrides a native provider too", () => {
    expect(
      providerCapabilities(provider("openai", { capabilities: "" }))
    ).toEqual([]);
  });
});

describe("acceptsFile", () => {
  it("sends images to vision models and PDFs to file readers", () => {
    expect(acceptsFile(["vision"], "image/png")).toBe(true);
    expect(acceptsFile(["files"], "image/png")).toBe(false);
    expect(acceptsFile(["files"], "application/PDF")).toBe(true);
    expect(acceptsFile(["vision"], "application/pdf")).toBe(false);
  });

  it("never sends other types as file parts", () => {
    expect(acceptsFile(["vision", "files"], "text/csv")).toBe(false);
    expect(
      acceptsFile(
        ["vision", "files"],
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      )
    ).toBe(false);
  });
});

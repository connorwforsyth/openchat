import { describe, expect, it } from "vitest";

// Cross-package relative import on purpose: packages/icons doesn't export its
// set ids, and the config enum has to stay equal to them.
import { iconSetIds } from "../../icons/src/set-ids";
import { appConfigSchema } from "./schema";

describe("appConfigSchema", () => {
  it("offers exactly the icon sets packages/icons knows", () => {
    const set = appConfigSchema.shape.icons.unwrap().shape.set.unwrap();
    expect([...set.options]).toEqual([...iconSetIds]);
  });

  it("round-trips its own output", () => {
    const parsed = appConfigSchema.parse({});
    expect(appConfigSchema.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(
      parsed
    );
  });

  it("accepts s3 storage and rejects an unknown driver", () => {
    expect(
      appConfigSchema.parse({ storage: { bucket: "files", driver: "s3" } })
        .storage
    ).toMatchObject({ driver: "s3", forcePathStyle: false, region: "auto" });
    expect(
      appConfigSchema.safeParse({ storage: { driver: "ftp" } }).success
    ).toBe(false);
  });

  it("keeps local files under ./.data unless told otherwise", () => {
    expect(
      appConfigSchema.parse({ storage: { driver: "local" } }).storage
    ).toEqual({ driver: "local", path: "./.data/files" });
    expect(
      appConfigSchema.parse({
        storage: { driver: "local", path: "/srv/files" },
      }).storage
    ).toEqual({ driver: "local", path: "/srv/files" });
  });

  it("records span content only when asked", () => {
    expect(
      appConfigSchema.parse({ observability: { recordContent: true } })
        .observability.recordContent
    ).toBe(true);
    expect(
      appConfigSchema.safeParse({ observability: { recordContent: "yes" } })
        .success
    ).toBe(false);
  });

  it("caps the agent loop at 20 steps unless told otherwise", () => {
    expect(appConfigSchema.parse({}).limits.agentMaxSteps).toBe(20);
    expect(
      appConfigSchema.parse({ limits: { agentMaxSteps: 50 } }).limits
        .agentMaxSteps
    ).toBe(50);
    expect(
      appConfigSchema.safeParse({ limits: { agentMaxSteps: 0 } }).success
    ).toBe(false);
  });

  it("orders the risk thresholds", () => {
    expect(
      appConfigSchema.safeParse({
        decider: { thresholds: { riskAsk: 0.9, riskBlock: 0.5 } },
      }).success
    ).toBe(false);
  });
});

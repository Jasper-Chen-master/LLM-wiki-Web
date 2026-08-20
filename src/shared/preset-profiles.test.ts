import { describe, expect, it } from "vitest";
import type { WikiProfile } from "./contracts.js";
import { getSavedPresetProfile, rememberPresetProfile } from "./preset-profiles.js";

const profile = (overrides: Partial<WikiProfile> = {}): WikiProfile => ({
  version: "1.0", researchGoal: "Understand the evidence", domain: "Research",
  entityTypes: ["concept"], importantFields: ["definition"], preferredRelations: [], exclude: [],
  extractNumericData: true, preserveUnits: true, extractTables: false, evidenceRequired: true,
  notes: "", preset: "experimental", outputLanguage: "en", ...overrides,
});

describe("saved preset profiles", () => {
  it("remembers edited built-in presets independently by language", () => {
    const zh = profile({ outputLanguage: "zh", researchGoal: "记住实验研究蓝图" });
    const en = profile({ outputLanguage: "en", researchGoal: "Remember the experiment blueprint" });
    const saved = rememberPresetProfile(rememberPresetProfile(undefined, zh), en);

    expect(getSavedPresetProfile({ presetProfiles: saved }, "experimental", "zh")?.researchGoal)
      .toBe("记住实验研究蓝图");
    expect(getSavedPresetProfile({ presetProfiles: saved }, "experimental", "en")?.researchGoal)
      .toBe("Remember the experiment blueprint");
  });

  it("does not turn a custom blueprint into a built-in preset override", () => {
    expect(rememberPresetProfile(undefined, profile({ preset: "custom" }))).toBeUndefined();
  });
});

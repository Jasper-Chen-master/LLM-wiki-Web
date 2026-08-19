import { describe, expect, it } from "vitest";
import type { WikiProfile } from "../../shared/contracts.js";
import { documentAnalysisSlicePrompt, generationPlanPrompt } from "./wiki-generation.js";

const profile = (preset: WikiProfile["preset"], customRequirements = "") : WikiProfile => ({
  version: "1.0",
  researchGoal: "Build a reliable Wiki",
  domain: "Test domain",
  entityTypes: [],
  importantFields: [],
  preferredRelations: [],
  exclude: [],
  extractNumericData: true,
  preserveUnits: true,
  extractTables: false,
  evidenceRequired: true,
  notes: "",
  outputLanguage: "en",
  preset,
  customRequirements,
});

describe("Wiki blueprint preset prompts", () => {
  it("keeps smart auto-detect free from a fixed paper or course ontology", () => {
    expect(documentAnalysisSlicePrompt(profile("auto"), "doc-a", [], {}, [])).toContain("Smart auto-detect mode");
  });

  it("grounds academic-paper planning in study conditions, findings, and conflict", () => {
    const prompt = generationPlanPrompt(profile("research"), []);
    expect(prompt).toContain("Academic papers mode");
    expect(prompt).toContain("incompatible study conditions");
  });

  it("grounds course planning in derivations and prerequisite learning paths", () => {
    const prompt = generationPlanPrompt(profile("course"), []);
    expect(prompt).toContain("Course learning mode");
    expect(prompt).toContain("prerequisites");
  });

  it("makes custom requirements authoritative", () => {
    const prompt = generationPlanPrompt(profile("custom", "Only retain legally binding clauses."), []);
    expect(prompt).toContain("Custom mode");
    expect(prompt).toContain("customRequirements are authoritative");
  });
});

import { describe, expect, it } from "vitest";
import type { Evidence, WikiGenerationPlan } from "../../shared/contracts.js";
import { buildEvidenceBoundGraph, clearProjectGraphKnowledge } from "./graph-service.js";

const evidence: Evidence = { id: "e", documentId: "doc", page: 1, blockId: "b", originalText: "A depends on B.", status: "reported" };
const plan: WikiGenerationPlan = {
  version: "2.0", outputLanguage: "en", researchGoal: "Understand dependencies", corpusSummary: "Technical notes",
  themes: [], requiredKnowledge: [], categories: [{ id: "component", label: "Component", role: "other", definition: "A component", inclusionExamples: [], exclusionExamples: [] }],
  relationTypes: ["depends on"], classificationRules: [], detectedPreset: "technical", unitOfAnalysis: "component", targetQuestions: [], fieldRules: [],
  relationRules: [{ id: "depends-on", label: "depends on", definition: "One component requires another", allowedSourceCategoryIds: ["component"], allowedTargetCategoryIds: ["component"], symmetric: false, requiresConditions: false, allowInferred: false }],
  qualityPolicy: { relevanceThreshold: .42, entityThreshold: .6, relationThreshold: .74, criticalCoverageTarget: .9, maximumGenericRelationRatio: .1 },
  analyzedDocumentIds: ["doc"], createdAt: "2026-08-18T00:00:00.000Z",
};
const entities = ["A", "B"].map(name => ({ name, type: "Component", evidenceIds: ["e"] }));

describe("adaptive graph relation validation", () => {
  it("does not turn co-occurrence into generic graph edges", () => {
    const graph = buildEvidenceBoundGraph({ projectId: "p", entities, relations: [], evidence: [evidence], plan });
    expect(graph.edges).toEqual([]);
  });

  it("accepts only evidence-backed semantic relations from the plan whitelist", () => {
    const graph = buildEvidenceBoundGraph({ projectId: "p", entities, evidence: [evidence], plan, relations: [
      { source: "A", target: "B", relationType: "depends on", evidenceIds: ["e"], confidence: .9, relationStatus: "reported" },
      { source: "A", target: "B", relationType: "related_to", evidenceIds: ["e"], confidence: .9, relationStatus: "reported" },
    ] });
    expect(graph.edges.map(edge => edge.relationType)).toEqual(["depends on"]);
    expect(graph.rejected.some(item => item.name.includes("related_to"))).toBe(true);
  });

  it("clears derived project knowledge but preserves parsed blocks for a mode rebuild", () => {
    const graph = buildEvidenceBoundGraph({ projectId: "p", entities, relations: [], evidence: [evidence], plan });
    const state = {
      projects: [], documents: [], blocks: [{ id: "b", documentId: "doc", page: 1, blockType: "paragraph" as const, text: "A depends on B.", sourceLocation: "page 1" }],
      evidence: [evidence], nodes: graph.nodes, edges: graph.edges, jobs: [], chatThreads: [], chatMessages: [],
      buildManifests: [], knowledgeCandidates: [], ontologyExtensionProposals: [],
      semanticResolutions: [], conceptRegistry: [],
      evidenceClaims: [], evidenceClaimCoverage: [],
      documentAnalyses: [],
    };
    clearProjectGraphKnowledge(state, "p");
    expect(state.blocks).toHaveLength(1);
    expect(state.nodes).toHaveLength(0);
    expect(state.evidence).toHaveLength(0);
  });
});

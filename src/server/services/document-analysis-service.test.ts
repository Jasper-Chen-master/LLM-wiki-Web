import { describe, expect, it } from "vitest";
import { DocumentKnowledgeAnalysisSchema, type ConceptRegistryEntry, type DocumentBlock, type DocumentRecord, type WikiProfile } from "../../shared/contracts.js";
import { materializeDocumentKnowledgeAnalysis, replaceDocumentAnalyses, type DocumentAnalysisSliceDraft } from "./document-analysis-service.js";
import { Store } from "../store.js";

const profile: WikiProfile = {
  version: "1.0", researchGoal: "Identify supported methods and findings", domain: "Research",
  entityTypes: ["Method", "Finding"], importantFields: ["conditions"], preferredRelations: [], exclude: [],
  extractNumericData: true, preserveUnits: true, extractTables: true, evidenceRequired: true,
  notes: "", outputLanguage: "en",
};
const document: DocumentRecord = {
  id: "doc-a", projectId: "project-a", fileName: "paper.pdf", kind: "pdf", role: "source",
  status: "parsed", uploadedAt: "2026-08-19T00:00:00.000Z", contentHash: "content-a",
};
const blocks: DocumentBlock[] = [1, 2, 3].map(index => ({
  id: `block-${index}`, documentId: "doc-a", page: index, blockType: "paragraph",
  text: `Source text ${index}`, sourceLocation: `page ${index}`,
}));
const registry: ConceptRegistryEntry[] = [{
  id: "registry-a", projectId: "project-a", ontologyRevision: 1, canonicalName: "Method A",
  displayName: "Method A", type: "Method", aliases: [], summary: "Existing method",
  memberCandidateIds: [], evidenceBlockIds: [], semanticMembers: [], confidence: 1,
  status: "active", createdAt: "2026-08-19T00:00:00.000Z", updatedAt: "2026-08-19T00:00:00.000Z",
}];

const slice: DocumentAnalysisSliceDraft = {
  summary: "The paper reports Method A and one result.", relevance: "direct",
  relevanceReason: "It directly answers the research goal.", sourceBoundary: "One paper and its reported experiment.",
  themes: ["methods", "results"],
  entities: [
    { name: "Method A", aliases: ["A"], evidenceBlockIds: ["block-1", "fabricated-block"] },
    { name: "Unsupported entity", aliases: [], evidenceBlockIds: ["fabricated-block"] },
  ],
  knowledgePoints: [{
    kind: "finding", title: "Reported result", statement: "The source reports a result.", status: "reported",
    conditions: { temperature: "300 K" }, importance: .8, confidence: .9,
    evidenceBlockIds: ["block-2", "fabricated-block"],
  }],
  suggestedWikiTopics: [{ title: "Method A", reason: "Reusable method", evidenceBlockIds: ["block-1"] }],
  existingConceptLinks: [
    { registryEntryId: "registry-a", reason: "Same supported method", evidenceBlockIds: ["block-1"] },
    { registryEntryId: "other-project-registry", reason: "Must be rejected", evidenceBlockIds: ["block-1"] },
  ],
  coverage: [
    { blockId: "block-1", status: "analyzed", reason: "Read" },
    { blockId: "block-2", status: "unresolved", reason: "Ambiguous" },
    { blockId: "fabricated-block", status: "analyzed", reason: "Must be rejected" },
  ],
};

describe("document knowledge analysis materialization", () => {
  it("binds every result to supplied blocks and retains missing coverage as unresolved", () => {
    const analysis = materializeDocumentKnowledgeAnalysis({
      projectId: "project-a", document, profile, blocks, slices: [slice], registry,
      now: "2026-08-19T01:00:00.000Z",
    });
    expect(() => DocumentKnowledgeAnalysisSchema.parse(analysis)).not.toThrow();
    expect(analysis.entities.map(entity => entity.name)).toEqual(["Method A"]);
    expect(analysis.entities[0].evidenceBlockIds).toEqual(["block-1"]);
    expect(analysis.knowledgePoints[0].evidenceBlockIds).toEqual(["block-2"]);
    expect(analysis.existingConceptLinks.map(link => link.registryEntryId)).toEqual(["registry-a"]);
    expect(analysis.coverage.analyzedBlockIds).toEqual(["block-1"]);
    expect(analysis.coverage.unresolvedBlockIds).toEqual(["block-2", "block-3"]);
  });

  it("creates stable analysis and knowledge-point ids for the same inputs", () => {
    const first = materializeDocumentKnowledgeAnalysis({ projectId: "project-a", document, profile, blocks, slices: [slice], registry });
    const second = materializeDocumentKnowledgeAnalysis({ projectId: "project-a", document, profile, blocks, slices: [slice], registry });
    expect(second.id).toBe(first.id);
    expect(second.knowledgePoints.map(point => point.id)).toEqual(first.knowledgePoints.map(point => point.id));
  });

  it("does not let synthesis invent support that was absent from all slice analyses", () => {
    const analysis = materializeDocumentKnowledgeAnalysis({
      projectId: "project-a", document, profile, blocks, slices: [slice], registry,
      synthesis: {
        summary: "Synthesis", relevance: "direct", relevanceReason: "Direct", sourceBoundary: "One paper",
        themes: [], entities: [], suggestedWikiTopics: [], existingConceptLinks: [],
        knowledgePoints: [{
          kind: "finding", title: "Invented during synthesis", statement: "Unsupported synthesis claim.",
          status: "reported", importance: 1, confidence: 1, evidenceBlockIds: ["block-3"],
        }],
      },
    });
    expect(analysis.knowledgePoints.some(point => point.title === "Invented during synthesis")).toBe(false);
  });

  it("replaces analyses only for the selected project and document ids", () => {
    const store = new Store();
    const analysis = materializeDocumentKnowledgeAnalysis({ projectId: "project-a", document, profile, blocks, slices: [slice], registry });
    const otherProjectAnalysis = { ...analysis, id: "other", projectId: "project-b" };
    store.data.documentAnalyses.push({ ...analysis, id: "old" }, otherProjectAnalysis);
    replaceDocumentAnalyses(store.data, "project-a", new Set(["doc-a"]), [analysis]);
    expect(store.data.documentAnalyses.map(item => item.id).sort()).toEqual([analysis.id, "other"].sort());
  });
});

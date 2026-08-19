import { describe, expect, it } from "vitest";
import type { CandidateCatalogOutput, DocumentBlock, WikiGenerationPlan, WikiProfile } from "../../shared/contracts.js";
import type { EvidenceClaimExtraction } from "../ai/provider.js";
import { materializeCandidateCatalog, materializeEvidenceClaimLedger } from "./candidate-claim-service.js";

const profile: WikiProfile = {
  version: "1.0", researchGoal: "Understand mechanics", domain: "Physics", entityTypes: ["Concept"],
  importantFields: [], preferredRelations: [], exclude: [], extractNumericData: true, preserveUnits: true,
  extractTables: false, evidenceRequired: true, notes: "", outputLanguage: "en",
};
const plan: WikiGenerationPlan = {
  version: "2.0", outputLanguage: "en", researchGoal: profile.researchGoal, corpusSummary: "Mechanics", themes: [],
  requiredKnowledge: [], categories: [{ id: "concept", label: "Concept", role: "concept", definition: "Reusable concept", inclusionExamples: [], exclusionExamples: [] }],
  relationTypes: [], classificationRules: [], detectedPreset: "course", unitOfAnalysis: "reusable course knowledge", targetQuestions: [], fieldRules: [], relationRules: [],
  qualityPolicy: { relevanceThreshold: .42, entityThreshold: .6, relationThreshold: .74, criticalCoverageTarget: .9, maximumGenericRelationRatio: .1 },
  nodeCreationPolicy: { version: "1.0", publishThreshold: .58, reviewThreshold: .34, minimumEvidenceCount: 1, requireIndependentMeaning: true, retainReviewCandidates: true },
  candidateExtractionContract: {
    version: "1.0", analysisUnit: "reusable course knowledge", atomicityRules: ["one fact", "direct evidence"],
    attachInsteadOfCreateRules: ["Examples attach"], exclusionRules: [], requiredClaimKinds: [], requireBlockCoverage: true,
  },
  analyzedDocumentIds: ["doc"], createdAt: "2026-08-19T00:00:00.000Z",
};
const blocks: DocumentBlock[] = [
  { id: "block-general", documentId: "doc", page: 1, blockType: "paragraph", sourceLocation: "page 1", text: "Path independence is a property of conservative forces." },
  { id: "block-gravity", documentId: "doc", page: 2, blockType: "paragraph", sourceLocation: "page 2", text: "Work done by gravity is path independent." },
  { id: "block-admin", documentId: "doc", page: 3, blockType: "paragraph", sourceLocation: "page 3", text: "Office hours are Friday." },
];

describe("Evidence Claim ledger and global Candidate Catalog", () => {
  it("requires every relevant block to have an auditable coverage outcome", () => {
    const extraction: EvidenceClaimExtraction = {
      coverage: [{ blockId: "block-general", status: "claimed", reason: "Defines a course concept." }],
      claims: [{
        blockId: "block-general", disposition: "candidate", kind: "definition", statement: "Path independence characterizes a conservative force.",
        suggestedName: "Path independence", suggestedType: "Concept", aliases: [], properties: {}, importance: .9, confidence: .95, reason: "Direct definition.",
      }],
      relations: [],
    };
    const ledger = materializeEvidenceClaimLedger({ projectId: "project", ontologyRevision: 1, blocks, extraction, now: "2026-08-19T00:00:00.000Z" });
    expect(ledger.coverage).toHaveLength(3);
    expect(ledger.coverage.filter(item => item.status === "unresolved").map(item => item.blockId))
      .toEqual(["block-gravity", "block-admin"]);
    expect(ledger.claims[0].id).toContain("project:claim:");
  });

  it("keeps claim identifiers stable when the provider changes only its output order", () => {
    const claims: EvidenceClaimExtraction["claims"] = [
      { blockId: "block-general", disposition: "candidate", kind: "definition", statement: "A claim.", suggestedName: "A", suggestedType: "Concept", aliases: [], properties: {}, importance: .8, confidence: .9, reason: "Direct." },
      { blockId: "block-general", disposition: "candidate", kind: "principle", statement: "B claim.", suggestedName: "B", suggestedType: "Concept", aliases: [], properties: {}, importance: .8, confidence: .9, reason: "Direct." },
    ];
    const coverage: EvidenceClaimExtraction["coverage"] = [{ blockId: "block-general", status: "claimed", reason: "Relevant." }];
    const first = materializeEvidenceClaimLedger({ projectId: "project", ontologyRevision: 1, blocks: blocks.slice(0, 1), extraction: { coverage, claims, relations: [] } });
    const second = materializeEvidenceClaimLedger({ projectId: "project", ontologyRevision: 1, blocks: blocks.slice(0, 1), extraction: { coverage, claims: [...claims].reverse(), relations: [] } });
    expect(second.claims.map(claim => claim.id)).toEqual(first.claims.map(claim => claim.id));
  });

  it("builds one candidate from a general claim and its scoped evidence claim without dropping evidence", () => {
    const extraction: EvidenceClaimExtraction = {
      coverage: [
        { blockId: "block-general", status: "claimed", reason: "Definition." },
        { blockId: "block-gravity", status: "claimed", reason: "Scoped application." },
        { blockId: "block-admin", status: "no_goal_relevant_claim", reason: "Administrative text." },
      ],
      claims: [
        { blockId: "block-general", disposition: "candidate", kind: "principle", statement: "Path independence characterizes conservative forces.", suggestedName: "Path independence", suggestedType: "Concept", aliases: [], properties: {}, importance: .9, confidence: .95, reason: "Definition." },
        { blockId: "block-gravity", disposition: "attach", kind: "instance", statement: "Gravity work is path independent.", suggestedName: "Gravity work path independence", suggestedType: "Concept", aliases: [], properties: {}, scope: "gravity", importance: .75, confidence: .92, reason: "Scoped instance." },
      ], relations: [],
    };
    const ledger = materializeEvidenceClaimLedger({ projectId: "project", ontologyRevision: 1, blocks, extraction, now: "2026-08-19T00:00:00.000Z" });
    const catalog: CandidateCatalogOutput = { groups: [{
      canonicalClaimId: ledger.claims[0].id, canonicalName: "Path independence", canonicalType: "Concept",
      canonicalSummary: "A conservative-force property in which work does not depend on route.",
      members: [
        { claimId: ledger.claims[0].id, action: "keep_separate", reason: "General concept." },
        { claimId: ledger.claims[1].id, action: "instance_of", scope: "gravity", reason: "Concrete instance." },
      ], importance: .9, confidence: .94, reason: "One general concept with scoped support.",
    }] };
    const result = materializeCandidateCatalog({ projectId: "project", plan, claims: ledger.claims, proposal: catalog });
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].evidenceIds).toEqual(["block-general", "block-gravity"]);
    expect(result.entities[0].claimIds).toEqual(ledger.claims.map(claim => claim.id));
    expect(result.claims.map(claim => claim.catalogCandidateName)).toContain("Path independence");
    expect(result.canonicalNameByClaimName.get("gravity work path independence")).toBe("Path independence");
  });

  it("fails safely by creating separate preliminary candidates for incomplete Catalog output", () => {
    const extraction: EvidenceClaimExtraction = {
      coverage: blocks.slice(0, 2).map(block => ({ blockId: block.id, status: "claimed" as const, reason: "Relevant." })),
      claims: [
        { blockId: "block-general", disposition: "candidate", kind: "concept", statement: "A", suggestedName: "A", suggestedType: "Concept", aliases: [], properties: {}, importance: .8, confidence: .8, reason: "A" },
        { blockId: "block-gravity", disposition: "candidate", kind: "concept", statement: "B", suggestedName: "B", suggestedType: "Concept", aliases: [], properties: {}, importance: .8, confidence: .8, reason: "B" },
      ], relations: [],
    };
    const ledger = materializeEvidenceClaimLedger({ projectId: "project", ontologyRevision: 1, blocks: blocks.slice(0, 2), extraction });
    const output: CandidateCatalogOutput = { groups: [{
      canonicalClaimId: ledger.claims[0].id, canonicalName: "A", canonicalType: "Concept", canonicalSummary: "A",
      members: [{ claimId: ledger.claims[0].id, action: "keep_separate", reason: "A" }], importance: .8, confidence: .9, reason: "A",
    }] };
    const result = materializeCandidateCatalog({ projectId: "project", plan, claims: ledger.claims, proposal: output });
    expect(result.entities.map(entity => entity.name).sort()).toEqual(["A", "B"]);
  });
});

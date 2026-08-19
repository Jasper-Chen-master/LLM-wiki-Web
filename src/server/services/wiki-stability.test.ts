import { describe, expect, it } from "vitest";
import type {
  ConceptRegistryEntry, DocumentBlock, DocumentRecord, KnowledgeCandidate, WikiGenerationPlan, WikiProfile,
} from "../../shared/contracts.js";
import { chunkParsedBlocks, DOCUMENT_CHUNK_MAX_CHARS, stableDocumentBlockId } from "../document-parser.js";
import { buildGraph } from "./graph-service.js";
import { createBuildManifest } from "./build-manifest-service.js";
import { evaluateKnowledgeCandidates } from "./knowledge-candidate-service.js";
import { createOntologyExtensionProposal } from "./ontology-extension-service.js";
import { ensurePlanCategoriesForEntities } from "./wiki-planning-service.js";
import {
  materializeSemanticConsolidation, rewriteRelationsWithSemanticMap,
  applyStableConceptSummaries,
} from "./semantic-consolidation-service.js";

const profile: WikiProfile = {
  version: "1.0", researchGoal: "Understand stable knowledge", domain: "Test",
  entityTypes: ["Concept"], importantFields: [], preferredRelations: [], exclude: [],
  extractNumericData: true, preserveUnits: true, extractTables: false,
  evidenceRequired: true, notes: "", outputLanguage: "en", qualityPreference: "balanced",
};

const plan: WikiGenerationPlan = {
  version: "2.0", outputLanguage: "en", researchGoal: profile.researchGoal,
  corpusSummary: "Stable test corpus", themes: [], requiredKnowledge: [],
  categories: [{ id: "concept", label: "Concept", role: "concept", definition: "A reusable concept", inclusionExamples: [], exclusionExamples: [] }],
  relationTypes: [], classificationRules: [], detectedPreset: "research", unitOfAnalysis: "concept",
  targetQuestions: [], fieldRules: [], relationRules: [],
  qualityPolicy: { relevanceThreshold: .42, entityThreshold: .6, relationThreshold: .74, criticalCoverageTarget: .9, maximumGenericRelationRatio: .1 },
  nodeCreationPolicy: { version: "1.0", publishThreshold: .58, reviewThreshold: .34, minimumEvidenceCount: 1, requireIndependentMeaning: true, retainReviewCandidates: true },
  analyzedDocumentIds: ["doc-a"], createdAt: "2026-08-19T00:00:00.000Z",
};

const block: DocumentBlock = {
  id: "doc-a:block:stable", documentId: "doc-a", page: 1, blockType: "paragraph",
  text: "Stable Concept is a reusable idea with a precise definition and supporting explanation.",
  sourceLocation: "PDF page 1 · chunk 1",
};

const candidate = (id: string, name: string, evidenceBlockId: string): KnowledgeCandidate => ({
  id: `project-a:candidate:${id}`,
  projectId: "project-a",
  canonicalKey: name.toLocaleLowerCase(),
  name,
  canonicalName: name,
  proposedType: "Concept",
  aliases: [],
  summary: `${name} is an evidence-backed concept with independently useful explanatory meaning.`,
  properties: {},
  evidenceBlockIds: [evidenceBlockId],
  sourceDocumentIds: ["doc-a"],
  score: { userRelevance: .9, evidenceStrength: .8, conceptualIndependence: .8, structuredCompleteness: .7, total: .83 },
  decision: "publish_node",
  decisionReason: "Eligible for semantic consolidation.",
  ontologyRevision: 1,
  createdAt: "2026-08-19T00:00:00.000Z",
  updatedAt: "2026-08-19T00:00:00.000Z",
});

describe("reproducible Wiki construction", () => {
  it("chunks long parser output deterministically without losing the page tail", () => {
    const tail = "FINAL_TAIL_MARKER";
    const text = `${"A stable sentence describes evidence. ".repeat(100)}${tail}`;
    const input = [{ page: 1, blockType: "paragraph" as const, text, sourceLocation: "PDF page 1" }];
    const first = chunkParsedBlocks(input);
    const second = chunkParsedBlocks(input);
    expect(second).toEqual(first);
    expect(first.every(item => item.text.length <= DOCUMENT_CHUNK_MAX_CHARS)).toBe(true);
    expect(first.at(-1)?.text).toContain(tail);
    expect(stableDocumentBlockId("doc-a", "hash", first[0], 0))
      .toBe(stableDocumentBlockId("doc-a", "hash", second[0], 0));
  });

  it("uses the same manifest input fingerprint when run metadata changes", async () => {
    const document: DocumentRecord = {
      id: "doc-a", projectId: "project-a", fileName: "paper.pdf", kind: "pdf", role: "source",
      status: "parsed", uploadedAt: "2026-08-19T00:00:00.000Z", contentHash: "content-hash",
      parserEngine: "pdfjs", parserVersion: "document-parser-v2", chunkingVersion: "semantic-boundary-v1", blockCount: 1,
    };
    const first = await createBuildManifest({ projectId: "project-a", jobId: "job-1", profile, documents: [document], blocks: [block], ontologyRevision: 1 });
    const equivalentDocument = { ...document, id: "doc-b" };
    const equivalentBlock = { ...block, id: "doc-b:block:stable", documentId: "doc-b" };
    const second = await createBuildManifest({ projectId: "project-a", jobId: "job-2", profile, documents: [equivalentDocument], blocks: [equivalentBlock], ontologyRevision: 1 });
    expect(second.inputFingerprint).toBe(first.inputFingerprint);
    expect(second.id).not.toBe(first.id);
  });

  it("records a distinct frozen-plan fingerprint without changing the source-input fingerprint", async () => {
    const document: DocumentRecord = {
      id: "doc-a", projectId: "project-a", fileName: "paper.pdf", kind: "pdf", role: "source",
      status: "parsed", uploadedAt: "2026-08-19T00:00:00.000Z", contentHash: "content-hash",
      parserEngine: "pdfjs", parserVersion: "document-parser-v2", chunkingVersion: "semantic-boundary-v1", blockCount: 1,
    };
    const first = await createBuildManifest({ projectId: "project-a", jobId: "job-1", profile, documents: [document], blocks: [block], ontologyRevision: 1, plan });
    const revisedPlan = { ...plan, candidateExtractionContract: {
      version: "1.0" as const, analysisUnit: "concept", atomicityRules: ["One direct claim"],
      attachInsteadOfCreateRules: ["Attach scoped examples"], exclusionRules: [], requiredClaimKinds: [], requireBlockCoverage: true,
    } };
    const second = await createBuildManifest({ projectId: "project-a", jobId: "job-2", profile, documents: [document], blocks: [block], ontologyRevision: 1, plan: revisedPlan });
    expect(second.inputFingerprint).toBe(first.inputFingerprint);
    expect(second.generationPlanFingerprint).not.toBe(first.generationPlanFingerprint);
  });

  it("retains low-eligibility candidates for review while publishing strong candidates", () => {
    const result = evaluateKnowledgeCandidates({
      projectId: "project-a", ontologyRevision: 1, profile, plan, blocks: [block], now: "2026-08-19T00:00:00.000Z",
      entities: [
        { name: "Stable Concept", type: "Concept", summary: "A reusable concept with enough independent meaning to support a Wiki page.", properties: { definition: "Reusable idea" }, importance: .9, evidenceIds: [block.id] },
        { name: "Incidental modifier", type: "Concept", importance: .4, evidenceIds: [block.id] },
      ],
    });
    expect(result.publishableEntities.map(entity => entity.name)).toEqual(["Stable Concept"]);
    expect(result.candidates.find(candidate => candidate.name === "Incidental modifier")?.decision).toBe("review");
    expect(result.candidates).toHaveLength(2);
  });

  it("keeps evidence identifiers stable for the same project blocks", () => {
    const extraction = { entities: [{ name: "Stable Concept", type: "Concept", evidenceIds: [block.id] }], relations: [] };
    const first = buildGraph("project-a", extraction, [block], plan);
    const second = buildGraph("project-a", extraction, [block], plan);
    expect(second.evidence[0].id).toBe(first.evidence[0].id);
    expect(second.nodes[0].id).toBe(first.nodes[0].id);
  });

  it("records new schema ideas as proposals without mutating the frozen plan", () => {
    const frozenPlan: WikiGenerationPlan = { ...plan, frozen: true };
    ensurePlanCategoriesForEntities(frozenPlan, [{ name: "A newly named theorem", type: "Theorem" }]);
    const proposedPlan: WikiGenerationPlan = {
      ...plan,
      categories: [...plan.categories, { id: "claim", label: "Claim", role: "other", definition: "A source claim", inclusionExamples: [], exclusionExamples: [] }],
      fieldRules: [{ id: "scope", label: "Scope", description: "Claim scope", priority: "high", valueType: "text", unitRequired: false, evidenceRequired: true }],
    };
    const proposal = createOntologyExtensionProposal({
      projectId: "project-a", baseOntologyRevision: 1, basePlan: frozenPlan, proposedPlan,
      sourceDocumentIds: ["doc-new"], now: "2026-08-19T00:00:00.000Z",
    });
    expect(proposal?.categories.map(category => category.id)).toEqual(["claim"]);
    expect(proposal?.status).toBe("pending");
    expect(frozenPlan.categories).toHaveLength(1);
  });

  it("lets AI semantic understanding absorb scoped concepts while preserving every member and evidence", () => {
    const candidates = [
      candidate("general", "路径无关性", "block-general"),
      candidate("gravity", "重力做功与路径无关", "block-gravity"),
      candidate("spring", "弹簧力做功与路径无关", "block-spring"),
    ];
    const result = materializeSemanticConsolidation({
      projectId: "project-a",
      ontologyRevision: 1,
      plan,
      candidates,
      existingRegistry: [],
      now: "2026-08-19T00:00:00.000Z",
      proposal: { groups: [{
        canonicalCandidateId: candidates[0].id,
        canonicalName: "路径无关性",
        canonicalType: "Concept",
        canonicalSummary: "保守力做功只取决于始末状态，与具体路径无关。",
        members: [
          { candidateId: candidates[0].id, action: "keep_separate", reason: "通用概念作为规范入口。" },
          { candidateId: candidates[1].id, action: "instance_of", scope: "重力场", reason: "重力做功是该原则的具体应用。" },
          { candidateId: candidates[2].id, action: "specialization_of", scope: "理想弹簧", reason: "弹簧力情形保留其适用条件。" },
        ],
        confidence: .94,
        reason: "三个候选共享同一通用语义，后两者是带作用域的实例。",
      }] },
    });
    expect(result.consolidatedEntities).toHaveLength(1);
    expect(result.consolidatedEntities[0].semanticMembers).toHaveLength(3);
    expect(result.consolidatedEntities[0].evidenceIds).toEqual(["block-general", "block-gravity", "block-spring"]);
    expect(result.registryEntries[0].memberCandidateIds).toHaveLength(3);
    expect(result.resolutions[0].source).toBe("ai");

    const rewritten = rewriteRelationsWithSemanticMap([{
      source: "重力做功与路径无关", target: "机械能守恒", relationType: "支持",
      evidenceIds: ["block-gravity"],
    }], result.canonicalNameByCandidateName);
    expect(rewritten[0].source).toBe("路径无关性");
  });

  it("fails safely by keeping candidates separate when AI merge confidence is too low", () => {
    const candidates = [
      candidate("general", "路径无关性", "block-general"),
      candidate("gravity", "重力做功与路径无关", "block-gravity"),
    ];
    const result = materializeSemanticConsolidation({
      projectId: "project-a", ontologyRevision: 1, plan, candidates, existingRegistry: [],
      proposal: { groups: [{
        canonicalCandidateId: candidates[0].id, canonicalName: "路径无关性", canonicalType: "Concept",
        canonicalSummary: "可能相关，但证据不足。",
        members: [
          { candidateId: candidates[0].id, action: "keep_separate", reason: "规范候选。" },
          { candidateId: candidates[1].id, action: "uncertain", reason: "不能安全判断是否应被吸收。" },
        ],
        confidence: .6, reason: "低置信度判断。",
      }] },
    });
    expect(result.consolidatedEntities).toHaveLength(2);
    expect(result.resolutions.every(item => item.source === "fallback")).toBe(true);
  });

  it("reuses a valid AI-selected Concept Registry identity across incremental builds", () => {
    const scoped = candidate("gravity", "重力做功与路径无关", "block-gravity");
    const existing: ConceptRegistryEntry = {
      id: "project-a:concept:path-independence", projectId: "project-a", ontologyRevision: 1,
      canonicalName: "路径无关性", displayName: "路径无关性", type: "Concept", aliases: [],
      summary: "做功与具体路径无关。", memberCandidateIds: [], evidenceBlockIds: [], semanticMembers: [],
      confidence: .95, status: "active", createdAt: "2026-08-19T00:00:00.000Z", updatedAt: "2026-08-19T00:00:00.000Z",
    };
    const result = materializeSemanticConsolidation({
      projectId: "project-a", ontologyRevision: 1, plan, candidates: [scoped], existingRegistry: [existing],
      proposal: { groups: [{
        canonicalCandidateId: scoped.id, registryEntryId: existing.id,
        canonicalName: "路径无关性", canonicalType: "Concept", canonicalSummary: existing.summary,
        members: [{ candidateId: scoped.id, action: "specialization_of", scope: "重力场", reason: "属于现有通用概念。" }],
        confidence: .9, reason: "复用现有规范概念。",
      }] },
    });
    expect(result.registryEntries[0].id).toBe(existing.id);
    expect(result.consolidatedEntities[0].registryEntryId).toBe(existing.id);
  });

  it("keeps an existing Wiki summary when the canonical claim and evidence membership did not change", () => {
    const entry: ConceptRegistryEntry = {
      id: "project-a:concept:stable", projectId: "project-a", ontologyRevision: 1,
      canonicalName: "Stable Concept", displayName: "Stable Concept", type: "Concept", aliases: [],
      summary: "The stable evidence-grounded wording.", memberCandidateIds: ["candidate-1"], claimIds: ["claim-1"],
      evidenceBlockIds: [block.id], semanticMembers: [], confidence: .9, status: "active",
      createdAt: "2026-08-19T00:00:00.000Z", updatedAt: "2026-08-19T00:01:00.000Z",
    };
    const output = applyStableConceptSummaries({
      existingRegistry: [entry], registryEntries: [{ ...entry, summary: "A newly sampled wording.", updatedAt: "2026-08-19T00:02:00.000Z" }],
      consolidatedEntities: [{ name: entry.canonicalName, type: entry.type, summary: "A newly sampled wording.", evidenceIds: [block.id], registryEntryId: entry.id }],
      summaries: { summaries: [{ registryEntryId: entry.id, summary: "Another newly sampled wording.", confidence: .9, reason: "Ignored because the evidence set did not change." }] },
    });
    expect(output.registryEntries[0].summary).toBe(entry.summary);
    expect(output.consolidatedEntities[0].summary).toBe(entry.summary);
  });
});

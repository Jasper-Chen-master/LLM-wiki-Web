import { z } from "zod";
import {
  WikiCategorySchema,
  CandidateExtractionContractSchema,
  WikiFieldRuleSchema,
  WikiGenerationPlanSchema,
  WikiQualityPolicySchema,
  WikiRelationRuleSchema,
  WikiPresetSchema,
  CandidateCatalogOutputSchema,
  SemanticConsolidationOutputSchema,
  WikiSummaryOutputSchema,
  type CandidateCatalogOutput,
  type ConceptRegistryEntry,
  type DocumentBlock,
  type DocumentKnowledgeAnalysis,
  type DocumentRecord,
  type EvidenceClaim,
  type JobBatchPhase,
  type KnowledgeCandidate,
  type SemanticConsolidationOutput,
  type WikiSummaryOutput,
  type WikiGenerationPlan,
  type WikiProfile,
} from "../../shared/contracts.js";
import { createLLMProvider, DemoLLMProvider, generateStructured, type LLMProvider } from "../llm-provider.js";
import {
  documentAnalysisSlicePrompt,
  documentAnalysisSynthesisPrompt,
  documentAnalysisSystemPrompt,
  evidenceClaimExtractionPrompt,
  evidenceClaimExtractionSystemPrompt,
  generationPlanPrompt,
  generationPlanSystemPrompt,
  relevancePrompt,
  relevanceSystemPrompt,
  candidateCatalogPrompt,
  candidateCatalogSystemPrompt,
  wikiSummarizationPrompt,
  wikiSummarizationSystemPrompt,
  semanticConsolidationPrompt,
  semanticConsolidationSystemPrompt,
} from "../prompts/wiki-generation.js";
import {
  fallbackGenerationPlan,
  normalizeGenerationPlan,
} from "../services/wiki-planning-service.js";
import {
  compactDocumentAnalyses,
  materializeDocumentKnowledgeAnalysis,
  type DocumentAnalysisSliceDraft,
  type DocumentAnalysisSynthesisDraft,
} from "../services/document-analysis-service.js";

const evidenceClaimExtractionSchema = z.object({
  coverage: z.array(z.object({
    blockId: z.string().min(1),
    status: z.enum(["claimed", "no_goal_relevant_claim", "unresolved"]),
    reason: z.string().trim().min(1).max(500),
  })).default([]),
  claims: z.array(z.object({
    blockId: z.string().min(1), disposition: z.enum(["candidate", "attach", "ignore"]),
    kind: z.string().trim().min(1).max(80), statement: z.string().trim().min(1).max(1_000),
    suggestedName: z.string().trim().min(1).max(200).optional(),
    suggestedType: z.string().trim().min(1).max(100).optional(),
    aliases: z.array(z.string().trim().min(1).max(200)).max(16).default([]),
    properties: z.record(z.string(), z.union([z.string(), z.number()])).default({}),
    scope: z.string().trim().max(500).optional(), importance: z.number().min(0).max(1).default(.6),
    confidence: z.number().min(0).max(1).default(.6), reason: z.string().trim().min(1).max(500),
  })).max(480).default([]),
  relations: z.preprocess(
    value => Array.isArray(value) ? value.map(item => {
      if (!item || typeof item !== "object") return item;
      const relation = item as Record<string, unknown>;
      return { ...relation, relationType: relation.relationType ?? relation.relation ?? relation.type ?? relation.predicate };
    }) : value,
    z.array(z.object({
      source: z.string().min(1), target: z.string().min(1), relationType: z.string().min(1),
      confidence: z.number().min(0).max(1).optional(), confidenceReason: z.string().min(1).max(320).optional(),
      evidenceIds: z.array(z.string()).optional(), relationStatus: z.enum(["observed", "reported", "inferred"]).optional(),
      conditions: z.record(z.string(), z.union([z.string(), z.number()])).optional(), scope: z.string().max(500).optional(),
    })).default([]),
  ),
});

const analysisEntitySchema = z.object({
  name: z.string().trim().min(1).max(200), type: z.string().trim().max(100).optional(),
  aliases: z.array(z.string().trim().min(1).max(200)).max(20).default([]),
  evidenceBlockIds: z.array(z.string().min(1)).max(32).default([]),
});
const analysisPointSchema = z.object({
  kind: z.enum(["definition", "concept", "entity", "method", "finding", "relationship", "contradiction", "other"]),
  title: z.string().trim().min(1).max(200), statement: z.string().trim().min(1).max(1_500),
  status: z.enum(["observed", "reported", "inferred"]), scope: z.string().trim().max(500).optional(),
  conditions: z.record(z.string(), z.union([z.string(), z.number()])).default({}),
  importance: z.number().min(0).max(1), confidence: z.number().min(0).max(1),
  evidenceBlockIds: z.array(z.string().min(1)).max(32).default([]),
});
const analysisTopicSchema = z.object({
  title: z.string().trim().min(1).max(200), reason: z.string().trim().min(1).max(800),
  evidenceBlockIds: z.array(z.string().min(1)).max(32).default([]),
});
const analysisConceptLinkSchema = z.object({
  registryEntryId: z.string().min(1), reason: z.string().trim().min(1).max(500),
  evidenceBlockIds: z.array(z.string().min(1)).max(32).default([]),
});
const documentAnalysisContentSchema = z.object({
  summary: z.string().trim().min(1).max(2_500),
  relevance: z.enum(["direct", "partial", "contextual", "out_of_scope"]),
  relevanceReason: z.string().trim().min(1).max(800),
  sourceBoundary: z.string().trim().min(1).max(1_000),
  themes: z.array(z.string().trim().min(1).max(160)).max(32).default([]),
  entities: z.array(analysisEntitySchema).max(160).default([]),
  knowledgePoints: z.array(analysisPointSchema).max(320).default([]),
  suggestedWikiTopics: z.array(analysisTopicSchema).max(80).default([]),
  existingConceptLinks: z.array(analysisConceptLinkSchema).max(80).default([]),
});
const documentAnalysisSliceSchema = documentAnalysisContentSchema.extend({
  coverage: z.array(z.object({
    blockId: z.string().min(1), status: z.enum(["analyzed", "unresolved"]),
    reason: z.string().trim().min(1).max(500),
  })).default([]),
});
const documentAnalysisSynthesisSchema = documentAnalysisContentSchema;

const generationPlanOutputSchema = z.object({
  corpusSummary: z.string().min(1).max(2_000), themes: z.array(z.string().min(1).max(160)).max(24),
  requiredKnowledge: z.array(z.string().min(1).max(240)).max(24),
  categories: z.array(WikiCategorySchema).min(1).max(16),
  relationTypes: z.array(z.string().min(1).max(100)).max(24),
  classificationRules: z.array(z.string().min(1).max(320)).max(30),
  detectedPreset: WikiPresetSchema.default("auto"), unitOfAnalysis: z.string().max(160).default(""),
  targetQuestions: z.array(z.string().min(1).max(500)).max(20).default([]),
  fieldRules: z.array(WikiFieldRuleSchema).max(32).default([]),
  relationRules: z.array(WikiRelationRuleSchema).max(24).default([]),
  qualityPolicy: WikiQualityPolicySchema.optional(),
  candidateExtractionContract: CandidateExtractionContractSchema.optional(),
});

const relevanceSchema = z.object({
  decisions: z.array(z.object({
    blockId: z.string().min(1), keep: z.boolean(), relevanceScore: z.number().min(0).max(1),
    reason: z.string().min(1).max(320), targetCategoryIds: z.array(z.string().min(1)).max(8),
  })).default([]),
});

export type EvidenceClaimExtraction = z.infer<typeof evidenceClaimExtractionSchema>;

export interface PipelineProgressUpdate {
  phase: JobBatchPhase;
  completed: number;
  total: number;
  elapsedSeconds: number;
}
export type WaitingProgressCallback = (update: PipelineProgressUpdate) => void | Promise<void>;

export interface PipelineProvider {
  analyzeDocuments(
    projectId: string,
    profile: WikiProfile,
    documents: DocumentRecord[],
    blocks: DocumentBlock[],
    registry: ConceptRegistryEntry[],
    onWaiting?: WaitingProgressCallback,
  ): Promise<DocumentKnowledgeAnalysis[]>;
  buildGenerationPlan(
    profile: WikiProfile,
    blocks: DocumentBlock[],
    analyses: DocumentKnowledgeAnalysis[],
    onWaiting?: WaitingProgressCallback,
  ): Promise<WikiGenerationPlan>;
  filterRelevant(profile: WikiProfile, plan: WikiGenerationPlan, blocks: DocumentBlock[], onWaiting?: WaitingProgressCallback): Promise<DocumentBlock[]>;
  extractEvidenceClaims(profile: WikiProfile, plan: WikiGenerationPlan, blocks: DocumentBlock[], onWaiting?: WaitingProgressCallback): Promise<EvidenceClaimExtraction>;
  catalogEvidenceClaims(profile: WikiProfile, plan: WikiGenerationPlan, claims: EvidenceClaim[], onWaiting?: WaitingProgressCallback): Promise<CandidateCatalogOutput>;
  summarizeConceptRegistry(profile: WikiProfile, plan: WikiGenerationPlan, entries: ConceptRegistryEntry[], blocks: DocumentBlock[], onWaiting?: WaitingProgressCallback): Promise<WikiSummaryOutput>;
  consolidateKnowledgeCandidates(
    profile: WikiProfile,
    plan: WikiGenerationPlan,
    candidates: KnowledgeCandidate[],
    blocks: DocumentBlock[],
    registry: ConceptRegistryEntry[],
    onWaiting?: WaitingProgressCallback,
  ): Promise<SemanticConsolidationOutput>;
}

type StageProgressReporter = (update: Omit<PipelineProgressUpdate, "elapsedSeconds">) => Promise<void>;

async function withStageProgress<T>(work: (report: StageProgressReporter) => Promise<T>, onWaiting?: WaitingProgressCallback): Promise<T> {
  const startedAt = Date.now();
  let latest: Omit<PipelineProgressUpdate, "elapsedSeconds"> | undefined;
  const report: StageProgressReporter = async update => {
    latest = update;
    await onWaiting?.({ ...update, elapsedSeconds: Math.max(0, Math.ceil((Date.now() - startedAt) / 1_000)) });
  };
  const timer = setInterval(() => {
    if (!latest || !onWaiting) return;
    void Promise.resolve(onWaiting({ ...latest, elapsedSeconds: Math.max(1, Math.ceil((Date.now() - startedAt) / 1_000)) })).catch(() => undefined);
  }, 1_000);
  try { return await work(report); } finally { clearInterval(timer); }
}

export function chunksByTextBudget<T>(
  items: T[],
  textLength: (item: T) => number,
  options: { maxChars: number; maxItems: number },
): T[][] {
  const chunks: T[][] = [];
  let current: T[] = [];
  let currentChars = 0;
  for (const item of items) {
    const itemChars = Math.max(1, textLength(item));
    if (current.length && (current.length >= options.maxItems || currentChars + itemChars > options.maxChars)) {
      chunks.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(item);
    currentChars += itemChars;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
  onCompleted?: (completed: number, total: number, index: number) => void | Promise<void>,
): Promise<R[]> {
  if (!items.length) return [];
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  let completed = 0;
  const runners = Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
      completed++;
      await onCompleted?.(completed, items.length, index);
    }
  });
  await Promise.all(runners);
  return results;
}

const configuredConcurrency = (name: string, fallback: number) => {
  const parsed = Number(process.env[name]);
  return Number.isInteger(parsed) ? Math.max(1, Math.min(parsed, 8)) : fallback;
};
const PLANNING_CONCURRENCY = configuredConcurrency("WIKI_PLANNING_CONCURRENCY", 2);
const PIPELINE_CONCURRENCY = configuredConcurrency("WIKI_PIPELINE_CONCURRENCY", 3);
const pipelineConcurrency = (profile: WikiProfile) => profile.costPreference === "quality" ? Math.min(2, PIPELINE_CONCURRENCY) : PIPELINE_CONCURRENCY;
const stageBudget = (profile: WikiProfile, stage: "relevance" | "extraction") => {
  const mode = profile.costPreference ?? "balanced";
  if (stage === "relevance") return mode === "economy" ? { maxChars: 28_000, maxItems: 64, itemChars: 1_400 } : mode === "quality" ? { maxChars: 14_000, maxItems: 28, itemChars: 2_200 } : { maxChars: 20_000, maxItems: 48, itemChars: 1_600 };
  if (stage === "extraction") return mode === "economy" ? { maxChars: 24_000, maxItems: 40, itemChars: 1_400 } : mode === "quality" ? { maxChars: 12_000, maxItems: 18, itemChars: 2_400 } : { maxChars: 18_000, maxItems: 28, itemChars: 1_600 };
  return mode === "economy" ? { maxChars: 24_000, maxItems: 40, itemChars: 1_400 } : mode === "quality" ? { maxChars: 12_000, maxItems: 18, itemChars: 2_400 } : { maxChars: 18_000, maxItems: 28, itemChars: 1_600 };
};

class SafePipelineProvider implements PipelineProvider {
  constructor(private readonly provider: LLMProvider) {}

  async analyzeDocuments(
    projectId: string,
    profile: WikiProfile,
    documents: DocumentRecord[],
    blocks: DocumentBlock[],
    registry: ConceptRegistryEntry[],
    onWaiting?: WaitingProgressCallback,
  ): Promise<DocumentKnowledgeAnalysis[]> {
    const blockGroups = new Map<string, DocumentBlock[]>();
    for (const block of blocks) blockGroups.set(block.documentId, [...(blockGroups.get(block.documentId) ?? []), block]);
    const documentInputs = documents
      .filter(document => blockGroups.has(document.id))
      .map(document => ({
        document,
        blocks: blockGroups.get(document.id)!,
        batches: chunksByTextBudget(
          blockGroups.get(document.id)!,
          block => block.text.length,
          profile.costPreference === "quality"
            ? { maxChars: 12_000, maxItems: 18 }
            : profile.costPreference === "economy"
              ? { maxChars: 24_000, maxItems: 48 }
              : { maxChars: 18_000, maxItems: 32 },
        ),
      }));
    if (!documentInputs.length) return [];
    const compactRegistry = registry.filter(entry => entry.status !== "orphaned").slice(0, 200).map(entry => ({
      id: entry.id, canonicalName: entry.canonicalName, type: entry.type,
      aliases: entry.aliases.slice(0, 20), summary: entry.summary.slice(0, 500),
    }));
    return withStageProgress(async report => {
      const totalSlices = documentInputs.reduce((sum, item) => sum + item.batches.length, 0);
      let completedSlices = 0;
      await report({ phase: "document_analysis", completed: 0, total: totalSlices });
      const sliceResults = await mapWithConcurrency(documentInputs, PLANNING_CONCURRENCY, async input => {
        const slices: DocumentAnalysisSliceDraft[] = [];
        for (const batch of input.batches) {
          let slice: DocumentAnalysisSliceDraft;
          if (this.provider instanceof DemoLLMProvider) {
            slice = {
              summary: batch.map(block => block.text).join(" ").slice(0, 2_500) || input.document.fileName,
              relevance: "contextual", relevanceReason: "Demo mode retains readable source content for deterministic processing.",
              sourceBoundary: `Document ${input.document.fileName}; no cross-document claims were introduced.`, themes: [],
              entities: [], knowledgePoints: [], suggestedWikiTopics: [], existingConceptLinks: [],
              coverage: batch.map(block => ({ blockId: block.id, status: "analyzed", reason: "Readable source block retained in demo mode." })),
            };
          } else {
            const priorDigest = slices.length ? {
              summaries: slices.slice(-3).map(item => item.summary),
              themes: [...new Set(slices.flatMap(item => item.themes))].slice(0, 24),
              entities: slices.flatMap(item => item.entities).slice(-60).map(entity => ({ name: entity.name, type: entity.type })),
              keyPoints: slices.flatMap(item => item.knowledgePoints).slice(-80).map(point => ({ kind: point.kind, title: point.title, statement: point.statement, status: point.status })),
            } : {};
            try {
              slice = await generateStructured(this.provider, {
                system: documentAnalysisSystemPrompt(profile),
                prompt: documentAnalysisSlicePrompt(profile, input.document.id, batch.map(block => ({
                  id: block.id, page: block.page, section: block.section, blockType: block.blockType, text: block.text,
                })), priorDigest, compactRegistry),
                temperature: 0,
                maxTokens: 10_000,
              }, documentAnalysisSliceSchema, 1);
            } catch {
              slice = {
                summary: profile.outputLanguage === "zh" ? "该文档切片分析失败。" : "This document slice could not be analyzed.",
                relevance: "contextual",
                relevanceReason: profile.outputLanguage === "zh" ? "结构化分析失败，未将内容判定为无关。" : "Structured analysis failed, so the content was not classified as irrelevant.",
                sourceBoundary: input.document.fileName, themes: [], entities: [], knowledgePoints: [],
                suggestedWikiTopics: [], existingConceptLinks: [],
                coverage: batch.map(block => ({ blockId: block.id, status: "unresolved", reason: "Structured document analysis failed for this slice." })),
              };
            }
          }
          slices.push(slice);
          completedSlices++;
          await report({ phase: "document_analysis", completed: completedSlices, total: totalSlices });
        }
        return { ...input, slices };
      });
      await report({ phase: "document_synthesis", completed: 0, total: sliceResults.length });
      return mapWithConcurrency(sliceResults, PLANNING_CONCURRENCY, async input => {
        let synthesis: DocumentAnalysisSynthesisDraft | undefined;
        if (input.slices.length === 1) {
          const { coverage: _coverage, ...content } = input.slices[0];
          synthesis = content;
        } else if (!(this.provider instanceof DemoLLMProvider)) {
          try {
            synthesis = await generateStructured(this.provider, {
              system: documentAnalysisSystemPrompt(profile),
              prompt: documentAnalysisSynthesisPrompt(profile, input.document.id, input.slices),
              temperature: 0,
              maxTokens: 12_000,
            }, documentAnalysisSynthesisSchema, 1);
          } catch {
            synthesis = undefined;
          }
        }
        return materializeDocumentKnowledgeAnalysis({
          projectId, document: input.document, profile, blocks: input.blocks,
          slices: input.slices, synthesis, registry,
        });
      }, (completed, total) => report({ phase: "document_synthesis", completed, total }));
    }, onWaiting);
  }

  async buildGenerationPlan(
    profile: WikiProfile,
    blocks: DocumentBlock[],
    analyses: DocumentKnowledgeAnalysis[],
    onWaiting?: WaitingProgressCallback,
  ): Promise<WikiGenerationPlan> {
    if (this.provider instanceof DemoLLMProvider) {
      await onWaiting?.({ phase: "plan_generation", completed: 0, total: 1, elapsedSeconds: 0 });
      await onWaiting?.({ phase: "plan_generation", completed: 1, total: 1, elapsedSeconds: 0 });
      return fallbackGenerationPlan(profile, blocks);
    }
    if (!analyses.length) {
      return fallbackGenerationPlan(profile, blocks);
    }
    const planningInput = compactDocumentAnalyses(analyses);
    const planMetadata = {
      version: "2.0" as const,
      outputLanguage: profile.outputLanguage ?? "en",
      researchGoal: profile.researchGoal,
      analyzedDocumentIds: [...new Set(blocks.map(block => block.documentId))],
      createdAt: new Date().toISOString(),
    };
    try {
      const generated = await withStageProgress(async report => {
        await report({ phase: "plan_generation", completed: 0, total: 1 });
        const result = await generateStructured(this.provider, {
          system: generationPlanSystemPrompt(profile),
          prompt: generationPlanPrompt(profile, planningInput),
          temperature: 0,
          maxTokens: 6_000,
        }, generationPlanOutputSchema, 1);
        await report({ phase: "plan_generation", completed: 1, total: 1 });
        return result;
      }, onWaiting);
      return normalizeGenerationPlan(WikiGenerationPlanSchema.parse({ ...generated, ...planMetadata }), profile);
    } catch {
      const fallback = fallbackGenerationPlan(profile, blocks);
      return normalizeGenerationPlan(WikiGenerationPlanSchema.parse({
        ...fallback,
        ...planMetadata,
        corpusSummary: analyses.map(analysis => analysis.summary).join(" ").slice(0, 2_000),
        themes: [...new Set(analyses.flatMap(analysis => analysis.themes))].slice(0, 24),
        requiredKnowledge: [...new Set(analyses.flatMap(analysis => [
          ...analysis.knowledgePoints.filter(point => point.importance >= .6).map(point => point.title),
          ...analysis.suggestedWikiTopics.map(topic => topic.title),
        ]))].slice(0, 24),
        classificationRules: [
          profile.outputLanguage === "zh"
            ? "名称明确表示定律、定理、理论、模型、方法、公式、实验或现象时，必须归入对应语义类别。"
            : "Names that explicitly identify a law, theorem, theory, model, method, formula, experiment, or phenomenon must use the corresponding semantic category.",
        ],
      }), profile);
    }
  }

  async filterRelevant(profile: WikiProfile, plan: WikiGenerationPlan, blocks: DocumentBlock[], onWaiting?: WaitingProgressCallback) {
    if (this.provider instanceof DemoLLMProvider) return blocks;
    const keptIds = new Set<string>();
    await withStageProgress(async report => {
      const budget = stageBudget(profile, "relevance");
      const batches = chunksByTextBudget(blocks, block => block.text.length, budget);
      await report({ phase: "relevance", completed: 0, total: batches.length });
      await mapWithConcurrency(batches, pipelineConcurrency(profile), async batch => {
        const evidenceMap = batch.map(block => ({ blockId: block.id, text: block.text }));
        try {
          const output = await generateStructured(this.provider, {
            system: relevanceSystemPrompt(profile),
            prompt: relevancePrompt(profile, plan, evidenceMap),
            temperature: 0,
            maxTokens: 5_000,
          }, relevanceSchema, 1);
          const suppliedIds = new Set(batch.map(block => block.id));
          const decidedIds = new Set<string>();
          for (const decision of output.decisions) {
            if (!suppliedIds.has(decision.blockId)) continue;
            decidedIds.add(decision.blockId);
            const threshold = plan.qualityPolicy?.relevanceThreshold ?? 0.42;
            if (decision.keep && decision.relevanceScore >= threshold) keptIds.add(decision.blockId);
          }
          // Missing decisions are retained: unreviewed evidence must not disappear silently.
          for (const block of batch) if (!decidedIds.has(block.id)) keptIds.add(block.id);
        } catch {
          for (const block of batch) keptIds.add(block.id);
        }
      }, (completed, total) => report({ phase: "relevance", completed, total }));
    }, onWaiting);
    return blocks.filter(block => keptIds.has(block.id));
  }

  async extractEvidenceClaims(profile: WikiProfile, plan: WikiGenerationPlan, blocks: DocumentBlock[], onWaiting?: WaitingProgressCallback): Promise<EvidenceClaimExtraction> {
    const fallbackFor = (batch: DocumentBlock[], failure?: string): EvidenceClaimExtraction => ({
      coverage: batch.map(block => ({
        blockId: block.id, status: "unresolved" as const,
        reason: failure
          ? `Evidence-claim extraction failed (${failure}); this block is retained as explicitly unresolved for a later retry.`
          : "Evidence-claim extraction was unavailable; this block is retained as explicitly unresolved for a later retry.",
      })),
      claims: [], relations: [],
    });
    if (this.provider instanceof DemoLLMProvider) return fallbackFor(blocks);
    return withStageProgress(async report => {
      const aggregate: EvidenceClaimExtraction = { coverage: [], claims: [], relations: [] };
      const budget = stageBudget(profile, "extraction");
      const batches = chunksByTextBudget(blocks, block => block.text.length, budget);
      await report({ phase: "claim_extraction", completed: 0, total: batches.length });
      const outputs = await mapWithConcurrency(batches, pipelineConcurrency(profile), async batch => {
        const evidenceMap = batch.map(block => ({ blockId: block.id, page: block.page, section: block.section, text: block.text }));
        const suppliedIds = new Set(batch.map(block => block.id));
        let prompt = evidenceClaimExtractionPrompt(profile, plan, evidenceMap);
        let lastError: unknown;
        try {
          for (let attempt = 0; attempt < 2; attempt++) {
            const output = await generateStructured(this.provider, {
              system: evidenceClaimExtractionSystemPrompt(profile),
              prompt,
              temperature: 0,
              maxTokens: 8_000,
            }, evidenceClaimExtractionSchema, 1);
            const coveredIds = new Set(output.coverage.filter(item => suppliedIds.has(item.blockId)).map(item => item.blockId));
            const missingIds = [...suppliedIds].filter(id => !coveredIds.has(id));
            if (!missingIds.length) return output;
            lastError = new Error(`missing coverage for blockIds: ${missingIds.join(", ")}`);
            prompt = `${evidenceClaimExtractionPrompt(profile, plan, evidenceMap)}

Your previous response omitted required coverage records for these blockIds:
${JSON.stringify(missingIds)}

Return the complete JSON object again. It must include exactly one coverage record for every supplied blockId, including the missing ids above.`;
          }
          throw lastError ?? new Error("missing required block coverage");
        } catch (error) {
          const message = error instanceof Error ? error.message.slice(0, 240) : "unknown provider or validation error";
          return fallbackFor(batch, message);
        }
      }, (completed, total) => report({ phase: "claim_extraction", completed, total }));
      for (const [index, output] of outputs.entries()) {
        const batch = batches[index];
        const suppliedIds = new Set(batch.map(block => block.id));
        const covered = new Set<string>();
        for (const coverage of output.coverage) {
          if (!suppliedIds.has(coverage.blockId) || covered.has(coverage.blockId)) continue;
          aggregate.coverage.push(coverage);
          covered.add(coverage.blockId);
        }
        // A missing block decision is audit-visible rather than silently treated as irrelevant.
        for (const block of batch) if (!covered.has(block.id)) {
          aggregate.coverage.push({
            blockId: block.id, status: "unresolved",
            reason: "The model did not return the required coverage decision for this block; retry is required before treating it as irrelevant.",
          });
        }
        aggregate.claims.push(...output.claims.filter(claim => suppliedIds.has(claim.blockId)));
        aggregate.relations.push(...output.relations.map(relation => ({
          ...relation,
          evidenceIds: (relation.evidenceIds ?? []).filter(id => suppliedIds.has(id)),
        })));
      }
      return aggregate;
    }, onWaiting);
  }

  async catalogEvidenceClaims(profile: WikiProfile, plan: WikiGenerationPlan, claims: EvidenceClaim[], onWaiting?: WaitingProgressCallback): Promise<CandidateCatalogOutput> {
    const eligible = claims.filter(claim => claim.disposition !== "ignore" && claim.suggestedName);
    const controlledTypes = new Set(plan.categories.map(category => category.label));
    const fallbackFor = (batch: EvidenceClaim[]): CandidateCatalogOutput => ({
      groups: batch.map(claim => ({
        canonicalClaimId: claim.id,
        canonicalName: claim.suggestedName ?? claim.statement.slice(0, 160),
        canonicalType: controlledTypes.has(claim.suggestedType ?? "") ? claim.suggestedType! : plan.categories[0].label,
        canonicalSummary: claim.statement,
        members: [{ claimId: claim.id, action: "keep_separate", scope: claim.scope, reason: "The catalog was unavailable, so this evidence claim remains a separate candidate." }],
        importance: claim.importance, confidence: claim.confidence,
        reason: "Safe fallback preserves the evidence claim as a separate candidate.",
      })),
    });
    if (!eligible.length || this.provider instanceof DemoLLMProvider) return fallbackFor(eligible);
    const ordered = [...eligible].sort((left, right) => left.blockId.localeCompare(right.blockId) || left.id.localeCompare(right.id));
    const payloadFor = (claim: EvidenceClaim) => ({
      id: claim.id, blockId: claim.blockId, disposition: claim.disposition, kind: claim.kind,
      statement: claim.statement, suggestedName: claim.suggestedName, suggestedType: claim.suggestedType,
      aliases: claim.aliases, properties: claim.properties, scope: claim.scope,
      importance: claim.importance, confidence: claim.confidence,
    });
    const batches = chunksByTextBudget(ordered, claim => JSON.stringify(payloadFor(claim)).length, { maxChars: 60_000, maxItems: 180 });
    return withStageProgress(async report => {
      await report({ phase: "candidate_catalog", completed: 0, total: batches.length });
      const outputs = await mapWithConcurrency(batches, Math.min(2, pipelineConcurrency(profile)), async batch => {
        try {
          return await generateStructured(this.provider, {
            system: candidateCatalogSystemPrompt(profile),
            prompt: candidateCatalogPrompt(profile, plan, batch.map(payloadFor)),
            temperature: 0,
            maxTokens: 12_000,
          }, CandidateCatalogOutputSchema, 1);
        } catch {
          return fallbackFor(batch);
        }
      }, (completed, total) => report({ phase: "candidate_catalog", completed, total }));
      return { groups: outputs.flatMap(output => output.groups) };
    }, onWaiting);
  }

  async summarizeConceptRegistry(profile: WikiProfile, plan: WikiGenerationPlan, entries: ConceptRegistryEntry[], blocks: DocumentBlock[], onWaiting?: WaitingProgressCallback): Promise<WikiSummaryOutput> {
    if (!entries.length || this.provider instanceof DemoLLMProvider) return { summaries: [] };
    const blockById = new Map(blocks.map(block => [block.id, block]));
    const payloadFor = (entry: ConceptRegistryEntry) => ({
      registryEntryId: entry.id, canonicalName: entry.canonicalName, type: entry.type,
      aliases: entry.aliases.slice(0, 20), semanticMembers: entry.semanticMembers.slice(0, 40),
      evidence: entry.evidenceBlockIds.map(id => blockById.get(id)).filter((block): block is DocumentBlock => Boolean(block))
        .slice(0, 8).map(block => ({ blockId: block.id, page: block.page, section: block.section, text: block.text.slice(0, 900) })),
    });
    const ordered = [...entries].sort((left, right) => left.id.localeCompare(right.id));
    const batches = chunksByTextBudget(ordered, entry => JSON.stringify(payloadFor(entry)).length, { maxChars: 48_000, maxItems: 60 });
    return withStageProgress(async report => {
      await report({ phase: "wiki_summarization", completed: 0, total: batches.length });
      const outputs = await mapWithConcurrency(batches, Math.min(2, pipelineConcurrency(profile)), async batch => {
        try {
          return await generateStructured(this.provider, {
            system: wikiSummarizationSystemPrompt(profile),
            prompt: wikiSummarizationPrompt(profile, plan, batch.map(payloadFor)),
            temperature: 0,
            maxTokens: 8_000,
          }, WikiSummaryOutputSchema, 1);
        } catch {
          return { summaries: [] };
        }
      }, (completed, total) => report({ phase: "wiki_summarization", completed, total }));
      return { summaries: outputs.flatMap(output => output.summaries) };
    }, onWaiting);
  }

  async consolidateKnowledgeCandidates(
    profile: WikiProfile,
    plan: WikiGenerationPlan,
    candidates: KnowledgeCandidate[],
    blocks: DocumentBlock[],
    registry: ConceptRegistryEntry[],
    onWaiting?: WaitingProgressCallback,
  ): Promise<SemanticConsolidationOutput> {
    const eligible = candidates.filter(candidate => candidate.decision !== "ignore");
    if (!eligible.length) return { groups: [] };
    const controlledTypes = new Set(plan.categories.map(category => category.label));
    const blockById = new Map(blocks.map(block => [block.id, block]));
    const payloadFor = (candidate: KnowledgeCandidate) => ({
      id: candidate.id,
      name: candidate.name,
      canonicalName: candidate.canonicalName,
      proposedType: controlledTypes.has(candidate.proposedType ?? "") ? candidate.proposedType : plan.categories[0].label,
      summary: candidate.summary.slice(0, 500),
      properties: Object.fromEntries(Object.entries(candidate.properties).slice(0, 16)),
      score: candidate.score,
      evidenceContext: candidate.evidenceBlockIds
        .map(id => blockById.get(id))
        .filter((block): block is DocumentBlock => Boolean(block))
        .slice(0, 4)
        .map(block => ({ blockId: block.id, page: block.page, section: block.section, text: block.text.slice(0, 500) })),
    });
    const compactRegistry = registry.filter(entry => entry.status !== "orphaned").slice(0, 200).map(entry => ({
      id: entry.id, canonicalName: entry.canonicalName, type: entry.type,
      aliases: entry.aliases.slice(0, 20), summary: entry.summary.slice(0, 400),
      semanticMembers: entry.semanticMembers.slice(0, 20),
    }));
    const fallbackFor = (batch: KnowledgeCandidate[]): SemanticConsolidationOutput => ({
      groups: batch.map(candidate => ({
        canonicalCandidateId: candidate.id,
        canonicalName: candidate.canonicalName ?? candidate.name,
        canonicalType: controlledTypes.has(candidate.proposedType ?? "") ? candidate.proposedType! : plan.categories[0].label,
        canonicalSummary: candidate.summary || candidate.name,
        members: [{ candidateId: candidate.id, action: "keep_separate", reason: "Semantic consolidation was unavailable; the evidence-backed candidate was preserved without merging." }],
        confidence: 1,
        reason: "Safe non-destructive fallback retained this candidate as a separate concept.",
      })),
    });
    if (this.provider instanceof DemoLLMProvider) return fallbackFor(eligible);
    const ordered = [...eligible].sort((left, right) =>
      (left.proposedType ?? "").localeCompare(right.proposedType ?? "")
      || left.canonicalKey.localeCompare(right.canonicalKey));
    const batches = chunksByTextBudget(ordered, candidate => JSON.stringify(payloadFor(candidate)).length, { maxChars: 45_000, maxItems: 100 });
    return withStageProgress(async report => {
      await report({ phase: "semantic_consolidation", completed: 0, total: batches.length });
      const outputs = await mapWithConcurrency(batches, Math.min(2, pipelineConcurrency(profile)), async batch => {
        try {
          return await generateStructured(this.provider, {
            system: semanticConsolidationSystemPrompt(profile),
            prompt: semanticConsolidationPrompt(profile, plan, batch.map(payloadFor), compactRegistry),
            temperature: 0,
            maxTokens: 12_000,
          }, SemanticConsolidationOutputSchema, 1);
        } catch {
          return fallbackFor(batch);
        }
      }, (completed, total) => report({ phase: "semantic_consolidation", completed, total }));
      return { groups: outputs.flatMap(output => output.groups) };
    }, onWaiting);
  }
}

export function getLlmProvider(): PipelineProvider {
  return new SafePipelineProvider(createLLMProvider());
}

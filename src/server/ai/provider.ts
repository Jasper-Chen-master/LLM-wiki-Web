import { z } from "zod";
import {
  WikiCategorySchema,
  WikiFieldRuleSchema,
  WikiGenerationPlanSchema,
  WikiQualityPolicySchema,
  WikiRelationRuleSchema,
  WikiPresetSchema,
  type DocumentBlock,
  type JobBatchPhase,
  type WikiClassificationDecision,
  type WikiGenerationPlan,
  type WikiProfile,
} from "../../shared/contracts.js";
import { createLLMProvider, DemoLLMProvider, generateStructured, type LLMProvider } from "../llm-provider.js";
import {
  classificationPrompt,
  classificationSystemPrompt,
  corpusAnalysisPrompt,
  corpusAnalysisSystemPrompt,
  extractionPrompt,
  extractionSystemPrompt,
  generationPlanPrompt,
  generationPlanSystemPrompt,
  relevancePrompt,
  relevanceSystemPrompt,
  semanticInterpretationPrompt,
  semanticInterpretationSystemPrompt,
} from "../prompts/wiki-generation.js";
import {
  categoryForIdentifier,
  fallbackGenerationPlan,
  normalizeGenerationPlan,
  representativeCorpusSample,
} from "../services/wiki-planning-service.js";

const extractionSchema = z.object({
  entities: z.array(z.object({
    name: z.string().min(1), canonicalName: z.string().optional(), type: z.string().optional(),
    aliases: z.array(z.string()).optional(), summary: z.string().optional(),
    properties: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
    importance: z.number().min(0).max(1).optional(), importanceReason: z.string().min(1).max(320).optional(),
    confidence: z.number().min(0).max(1).optional(), confidenceReason: z.string().min(1).max(320).optional(),
    evidenceIds: z.array(z.string()).optional(),
  })).default([]),
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

const corpusAnalysisSchema = z.object({
  corpusSummary: z.string().min(1).max(2_000), themes: z.array(z.string().min(1).max(160)).max(24),
  goalAlignment: z.string().min(1).max(1_500), requiredKnowledge: z.array(z.string().min(1).max(240)).max(24),
  suggestedCategories: z.array(WikiCategorySchema).max(16),
});

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
});

const relevanceSchema = z.object({
  decisions: z.array(z.object({
    blockId: z.string().min(1), keep: z.boolean(), relevanceScore: z.number().min(0).max(1),
    reason: z.string().min(1).max(320), targetCategoryIds: z.array(z.string().min(1)).max(8),
  })).default([]),
});

// Keep the envelopes permissive, then validate every item independently. A malformed semantic
// item is ignored for classification context; a malformed classification item falls back to its
// already-extracted controlled label. Neither case starts a second classification/review pass.
const semanticInterpretationItemSchema = z.object({
  entityName: z.string().min(1),
  semanticIdentity: z.string().min(1).max(360),
  semanticExplanation: z.string().min(1).max(700),
  decisionFactors: z.array(z.string().min(1).max(240)).min(1).max(6),
  identityEvidence: z.string().min(1).max(500),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1).max(320),
});
const semanticInterpretationEnvelopeSchema = z.object({ interpretations: z.array(z.unknown()).default([]) });
const classificationItemSchema = z.object({
  entityName: z.string().min(1),
  categoryId: z.string().min(1),
  confidence: z.number().min(0).max(1).default(1),
  reason: z.string().max(320).default("Selected from the complete source-grounded context."),
});
const classificationEnvelopeSchema = z.object({ classifications: z.array(z.unknown()).default([]) });
type SemanticInterpretation = z.infer<typeof semanticInterpretationItemSchema>;
type DirectClassification = z.infer<typeof classificationItemSchema>;

type ExtractedKnowledgeEntity = z.infer<typeof extractionSchema>["entities"][number] & {
  classification?: WikiClassificationDecision;
};
export type KnowledgeExtraction = Omit<z.infer<typeof extractionSchema>, "entities"> & {
  entities: ExtractedKnowledgeEntity[];
};

export interface PipelineProgressUpdate {
  phase: JobBatchPhase;
  completed: number;
  total: number;
  elapsedSeconds: number;
}
export type WaitingProgressCallback = (update: PipelineProgressUpdate) => void | Promise<void>;

export interface PipelineProvider {
  buildGenerationPlan(
    profile: WikiProfile,
    blocks: DocumentBlock[],
    onPhase?: (phase: "analyzing" | "planning") => void | Promise<void>,
    onWaiting?: WaitingProgressCallback,
  ): Promise<WikiGenerationPlan>;
  filterRelevant(profile: WikiProfile, plan: WikiGenerationPlan, blocks: DocumentBlock[], onWaiting?: WaitingProgressCallback): Promise<DocumentBlock[]>;
  extractKnowledge(profile: WikiProfile, plan: WikiGenerationPlan, blocks: DocumentBlock[], onWaiting?: WaitingProgressCallback): Promise<KnowledgeExtraction>;
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

const chunksOf = <T>(items: T[], size: number) =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, index * size + size));

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
const stageBudget = (profile: WikiProfile, stage: "relevance" | "extraction" | "semantic_interpretation" | "classification") => {
  const mode = profile.costPreference ?? "balanced";
  if (stage === "relevance") return mode === "economy" ? { maxChars: 28_000, maxItems: 64, itemChars: 1_400 } : mode === "quality" ? { maxChars: 14_000, maxItems: 28, itemChars: 2_200 } : { maxChars: 20_000, maxItems: 48, itemChars: 1_600 };
  if (stage === "extraction") return mode === "economy" ? { maxChars: 24_000, maxItems: 40, itemChars: 1_400 } : mode === "quality" ? { maxChars: 12_000, maxItems: 18, itemChars: 2_400 } : { maxChars: 18_000, maxItems: 28, itemChars: 1_600 };
  if (stage === "semantic_interpretation") return mode === "economy" ? { maxChars: 24_000, maxItems: 32, itemChars: 0 } : mode === "quality" ? { maxChars: 12_000, maxItems: 14, itemChars: 0 } : { maxChars: 16_000, maxItems: 22, itemChars: 0 };
  return mode === "economy" ? { maxChars: 28_000, maxItems: 96, itemChars: 0 } : mode === "quality" ? { maxChars: 14_000, maxItems: 40, itemChars: 0 } : { maxChars: 20_000, maxItems: 64, itemChars: 0 };
};

export class SafePipelineProvider implements PipelineProvider {
  constructor(private readonly provider: LLMProvider) {}

  async buildGenerationPlan(
    profile: WikiProfile,
    blocks: DocumentBlock[],
    onPhase?: (phase: "analyzing" | "planning") => void | Promise<void>,
    onWaiting?: WaitingProgressCallback,
  ): Promise<WikiGenerationPlan> {
    await onPhase?.("analyzing");
    if (this.provider instanceof DemoLLMProvider) {
      await onPhase?.("planning");
      return fallbackGenerationPlan(profile, blocks);
    }
    const samples = representativeCorpusSample(blocks, profile.costPreference === "economy" ? 5 : profile.costPreference === "quality" ? 12 : 8);
    const analyses = await withStageProgress(async report => {
      const batches = chunksOf(samples, 4);
      await report({ phase: "corpus_analysis", completed: 0, total: batches.length });
      const results = await mapWithConcurrency(batches, PLANNING_CONCURRENCY, async sampleBatch => {
        try {
          return await generateStructured(this.provider, {
            system: corpusAnalysisSystemPrompt(profile),
            prompt: corpusAnalysisPrompt(profile, sampleBatch),
            temperature: 0,
            maxTokens: 4_000,
          }, corpusAnalysisSchema, 1);
        } catch {
          // A failed slice does not erase analyses already grounded in other documents.
          return undefined;
        }
      }, (completed, total) => report({ phase: "corpus_analysis", completed, total }));
      return results.filter((analysis): analysis is z.infer<typeof corpusAnalysisSchema> => Boolean(analysis));
    }, onWaiting);
    if (!analyses.length) {
      await onPhase?.("planning");
      return fallbackGenerationPlan(profile, blocks);
    }
    await onPhase?.("planning");
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
          prompt: generationPlanPrompt(profile, analyses),
          temperature: 0,
          maxTokens: 6_000,
        }, generationPlanOutputSchema, 1);
        await report({ phase: "plan_generation", completed: 1, total: 1 });
        return result;
      }, onWaiting);
      return normalizeGenerationPlan(WikiGenerationPlanSchema.parse({ ...generated, ...planMetadata }), profile);
    } catch {
      const fallback = fallbackGenerationPlan(profile, blocks);
      const categories = [...analyses.flatMap(analysis => analysis.suggestedCategories), ...fallback.categories];
      return normalizeGenerationPlan(WikiGenerationPlanSchema.parse({
        ...fallback,
        ...planMetadata,
        corpusSummary: analyses.map(analysis => analysis.corpusSummary).join(" ").slice(0, 2_000),
        themes: [...new Set(analyses.flatMap(analysis => analysis.themes))].slice(0, 24),
        requiredKnowledge: [...new Set(analyses.flatMap(analysis => analysis.requiredKnowledge))].slice(0, 24),
        categories: categories.slice(0, 16),
        classificationRules: [
          profile.outputLanguage === "zh"
            ? "先依据原文证据重建节点的语义身份与边界，再将其映射到受控类别；名称、公式形式和章节标题不能单独决定分类。"
            : "Reconstruct each node's evidence-grounded semantic identity and boundary before mapping it to a controlled category; names, equation-like form, and headings cannot decide classification by themselves.",
        ],
      }), profile);
    }
  }

  async filterRelevant(profile: WikiProfile, plan: WikiGenerationPlan, blocks: DocumentBlock[], onWaiting?: WaitingProgressCallback) {
    if (this.provider instanceof DemoLLMProvider) return blocks;
    const keptIds = new Set<string>();
    await withStageProgress(async report => {
      const budget = stageBudget(profile, "relevance");
      const batches = chunksByTextBudget(blocks, block => Math.min(block.text.length, budget.itemChars), budget);
      await report({ phase: "relevance", completed: 0, total: batches.length });
      await mapWithConcurrency(batches, pipelineConcurrency(profile), async batch => {
        const evidenceMap = batch.map(block => ({
          blockId: block.id, documentId: block.documentId, page: block.page,
          section: block.section, blockType: block.blockType,
          text: block.text.slice(0, budget.itemChars),
        }));
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

  async extractKnowledge(profile: WikiProfile, plan: WikiGenerationPlan, blocks: DocumentBlock[], onWaiting?: WaitingProgressCallback) {
    if (this.provider instanceof DemoLLMProvider) return { entities: [], relations: [] };
    return withStageProgress(async report => {
      const aggregate: KnowledgeExtraction = { entities: [], relations: [] };
      const budget = stageBudget(profile, "extraction");
      const batches = chunksByTextBudget(blocks, block => Math.min(block.text.length, budget.itemChars), budget);
      await report({ phase: "extraction", completed: 0, total: batches.length });
      const batchErrors: string[] = [];
      const outputs = await mapWithConcurrency(batches, pipelineConcurrency(profile), async batch => {
        const evidenceMap = batch.map(block => ({
          blockId: block.id, documentId: block.documentId, page: block.page,
          section: block.section, blockType: block.blockType,
          text: block.text.slice(0, budget.itemChars),
        }));
        let output: KnowledgeExtraction;
        try {
          output = await generateStructured(this.provider, {
            system: extractionSystemPrompt(profile),
            prompt: extractionPrompt(profile, plan, evidenceMap),
            temperature: 0,
            maxTokens: 8_000,
          }, extractionSchema, 1);
        } catch (error) {
          batchErrors.push(error instanceof Error ? error.message : String(error));
          return undefined;
        }
        if (!output.entities.length && evidenceMap.length) {
          try {
            output = await generateStructured(this.provider, {
              system: extractionSystemPrompt(profile),
              prompt: `${extractionPrompt(profile, plan, evidenceMap)}\n上一次提取为空。请重新检查本批全部文档块，完成知识盘点与覆盖检查；补回与研究目标相关且有证据支持的定义、方法、机制、材料、数量、公式、实验、现象、条件、限制、结果和关系，不得编造事实。`,
              temperature: 0,
              maxTokens: 8_000,
            }, extractionSchema, 1);
          } catch (error) {
            batchErrors.push(error instanceof Error ? error.message : String(error));
            return undefined;
          }
        }
        return output;
      }, (completed, total) => report({ phase: "extraction", completed, total }));
      for (const output of outputs) if (output) {
        aggregate.entities.push(...output.entities);
        aggregate.relations.push(...output.relations);
      }
      // A silently empty extraction is indistinguishable from an empty corpus and leaves the
      // user with an unexplained "no entities found" build. Surface total extraction failure.
      if (!aggregate.entities.length && batchErrors.length && batches.length) {
        throw new Error(`Extraction failed for all ${batches.length} batch(es); first error: ${batchErrors[0]}`);
      }
      const normalizedEntityKey = (entity: { name: string; canonicalName?: string }) =>
        (entity.canonicalName ?? entity.name).normalize("NFKC").trim().toLocaleLowerCase();
      const normalizedText = (value: string) => value.normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase();
      const blockById = new Map(blocks.map(block => [block.id, block]));
      const classificationCandidates = new Map<string, KnowledgeExtraction["entities"][number]>();
      for (const entity of aggregate.entities) {
        const key = normalizedEntityKey(entity);
        const current = classificationCandidates.get(key);
        const representative = !current || (entity.summary?.length ?? 0) > (current.summary?.length ?? 0) ? entity : current;
        classificationCandidates.set(key, {
          ...representative,
          evidenceIds: [...new Set([...(current?.evidenceIds ?? []), ...(entity.evidenceIds ?? [])])],
        });
      }
      const candidates = [...classificationCandidates.values()];
      const evidenceBlocksFor = (entity: KnowledgeExtraction["entities"][number]) =>
        (entity.evidenceIds ?? []).map(id => blockById.get(id)).filter((block): block is DocumentBlock => Boolean(block)).slice(0, 6);
      const relationContextFor = (entity: KnowledgeExtraction["entities"][number]) => {
        const names = new Set([entity.name, entity.canonicalName, ...(entity.aliases ?? [])]
          .filter((name): name is string => Boolean(name)).map(normalizedText));
        return aggregate.relations.filter(relation => names.has(normalizedText(relation.source)) || names.has(normalizedText(relation.target)))
          .slice(0, 12)
          .map(relation => ({
            source: relation.source, relationType: relation.relationType, target: relation.target,
            status: relation.relationStatus, conditions: relation.conditions, scope: relation.scope,
          }));
      };
      const semanticPayload = (entity: KnowledgeExtraction["entities"][number]) => ({
        name: entity.name,
        canonicalName: entity.canonicalName,
        summary: entity.summary,
        properties: entity.properties,
        evidenceContext: evidenceBlocksFor(entity).map(block => ({
          blockId: block.id, page: block.page, section: block.section,
          blockType: block.blockType, text: block.text.slice(0, 900),
        })),
        relationContext: relationContextFor(entity),
      });
      const classificationKeysByName = new Map(candidates.flatMap(entity => {
        const key = normalizedEntityKey(entity);
        return [entity.name, entity.canonicalName, ...(entity.aliases ?? [])]
          .filter((name): name is string => Boolean(name))
          .map(name => [normalizedText(name), key] as const);
      }));

      // Preserve the complete understanding step: reconstruct each node from its evidence
      // before exposing the controlled category list. This is not a review queue; its output is
      // simply the semantic context passed to the one classification pass below.
      const semanticBudget = stageBudget(profile, "semantic_interpretation");
      const semanticBatches = chunksByTextBudget(
        candidates,
        entity => JSON.stringify(semanticPayload(entity)).length,
        semanticBudget,
      );
      const semanticInterpretations = new Map<string, SemanticInterpretation & { identityEvidenceVerified: boolean }>();
      await report({ phase: "semantic_interpretation", completed: 0, total: semanticBatches.length });
      const semanticResults = await mapWithConcurrency(semanticBatches, pipelineConcurrency(profile), async entityBatch => {
        try {
          return await generateStructured(this.provider, {
            system: semanticInterpretationSystemPrompt(profile),
            prompt: semanticInterpretationPrompt(profile, plan, entityBatch.map(semanticPayload)),
            temperature: 0,
            maxTokens: 6_500,
          }, semanticInterpretationEnvelopeSchema, 1);
        } catch {
          // Classification still runs for every node when an interpretation batch is unavailable.
          return undefined;
        }
      }, (completed, total) => report({ phase: "semantic_interpretation", completed, total }));
      for (const result of semanticResults) if (result) {
        for (const rawInterpretation of result.interpretations) {
          const parsed = semanticInterpretationItemSchema.safeParse(rawInterpretation);
          if (!parsed.success) continue;
          const interpretation = parsed.data;
          const entityKey = classificationKeysByName.get(normalizedText(interpretation.entityName));
          const entity = entityKey ? classificationCandidates.get(entityKey) : undefined;
          if (!entityKey || !entity) continue;
          const evidenceText = normalizedText(evidenceBlocksFor(entity).map(block => block.text).join("\n"));
          const excerpt = normalizedText(interpretation.identityEvidence);
          semanticInterpretations.set(entityKey, {
            ...interpretation,
            identityEvidenceVerified: Boolean(excerpt.length >= 6 && evidenceText.includes(excerpt)),
          });
        }
      }

      // The classifier receives both the semantic understanding and the original context. The
      // extractor's type is retained only as a server-side fallback and is never sent as a hint.
      const classificationPayload = (entity: KnowledgeExtraction["entities"][number]) => {
        const interpretation = semanticInterpretations.get(normalizedEntityKey(entity));
        const verifiedInterpretation = interpretation?.identityEvidenceVerified ? interpretation : undefined;
        return {
          ...semanticPayload(entity),
          semanticInterpretation: verifiedInterpretation ? {
            semanticIdentity: verifiedInterpretation.semanticIdentity,
            semanticExplanation: verifiedInterpretation.semanticExplanation,
            decisionFactors: verifiedInterpretation.decisionFactors,
            identityEvidence: verifiedInterpretation.identityEvidence,
            confidence: verifiedInterpretation.confidence,
          } : undefined,
        };
      };
      const classificationBudget = stageBudget(profile, "classification");
      const classificationBatches = chunksByTextBudget(
        candidates,
        entity => JSON.stringify(classificationPayload(entity)).length,
        classificationBudget,
      );
      const classifiedCandidates = new Map<string, { categoryId: string; result: DirectClassification }>();
      await report({ phase: "classification", completed: 0, total: classificationBatches.length });
      const classificationResults = await mapWithConcurrency(classificationBatches, pipelineConcurrency(profile), async entityBatch => {
        try {
          return await generateStructured(this.provider, {
            system: classificationSystemPrompt(profile),
            prompt: classificationPrompt(profile, plan, entityBatch.map(classificationPayload)),
            temperature: 0,
            maxTokens: 6_500,
          }, classificationEnvelopeSchema, 1);
        } catch {
          // The entity still receives its controlled extraction label below. No review pass is run.
          return undefined;
        }
      }, (completed, total) => report({ phase: "classification", completed, total }));
      for (const result of classificationResults) if (result) {
        for (const rawClassification of result.classifications) {
          const parsed = classificationItemSchema.safeParse(rawClassification);
          if (!parsed.success) continue;
          const classification = parsed.data;
          const entityKey = classificationKeysByName.get(normalizedText(classification.entityName));
          const category = categoryForIdentifier(plan, classification.categoryId);
          if (!entityKey || !category) continue;
          classifiedCandidates.set(entityKey, { categoryId: category.id, result: classification });
        }
      }

      aggregate.entities = aggregate.entities.map(entity => {
        const key = normalizedEntityKey(entity);
        const classified = classifiedCandidates.get(key);
        const fallback = categoryForIdentifier(plan, entity.type) ?? plan.categories[0];
        const category = classified ? categoryForIdentifier(plan, classified.categoryId) ?? fallback : fallback;
        if (!category) return entity;
        const interpretation = semanticInterpretations.get(key);
        const verifiedInterpretation = interpretation?.identityEvidenceVerified ? interpretation : undefined;
        const classification: WikiClassificationDecision | undefined = classified ? {
          semanticRole: category.role,
          categoryId: category.id,
          confidence: classified.result.confidence,
          status: "accepted",
          source: "llm",
          reason: classified.result.reason,
          semanticIdentity: verifiedInterpretation?.semanticIdentity,
          semanticExplanation: verifiedInterpretation?.semanticExplanation,
          decisionFactors: verifiedInterpretation?.decisionFactors,
          identityEvidence: verifiedInterpretation?.identityEvidence,
        } : undefined;
        return { ...entity, type: category.label, ...(classification ? { classification } : {}) };
      });
      return aggregate;
    }, onWaiting);
  }
}

export function getLlmProvider(): PipelineProvider {
  return new SafePipelineProvider(createLLMProvider());
}

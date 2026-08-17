import { z } from "zod";
import {
  WikiCategorySchema,
  WikiGenerationPlanSchema,
  type DocumentBlock,
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
} from "../prompts/wiki-generation.js";
import {
  applyPlannedEntityTypes,
  ensurePlanCategoriesForEntities,
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
});

const relevanceSchema = z.object({
  decisions: z.array(z.object({
    blockId: z.string().min(1), keep: z.boolean(), relevanceScore: z.number().min(0).max(1),
    reason: z.string().min(1).max(320), targetCategoryIds: z.array(z.string().min(1)).max(8),
  })).default([]),
});

const classificationSchema = z.object({
  classifications: z.array(z.object({
    entityName: z.string().min(1), categoryId: z.string().min(1), reason: z.string().min(1).max(320),
  })).default([]),
});

export type KnowledgeExtraction = z.infer<typeof extractionSchema>;

export type WaitingProgressCallback = (elapsedSeconds: number) => void | Promise<void>;

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

async function withWaitingProgress<T>(task: Promise<T>, onWaiting?: WaitingProgressCallback): Promise<T> {
  if (!onWaiting) return task;
  const startedAt = Date.now();
  const timer = setInterval(() => {
    void onWaiting(Math.max(1, Math.ceil((Date.now() - startedAt) / 1_000)));
  }, 1_000);
  try { return await task; } finally { clearInterval(timer); }
}

async function withStageProgress<T>(work: () => Promise<T>, onWaiting?: WaitingProgressCallback): Promise<T> {
  if (!onWaiting) return work();
  const startedAt = Date.now();
  const timer = setInterval(() => {
    void onWaiting(Math.max(1, Math.ceil((Date.now() - startedAt) / 1_000)));
  }, 1_000);
  try { return await work(); } finally { clearInterval(timer); }
}

const chunksOf = <T>(items: T[], size: number) =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, index * size + size));

class SafePipelineProvider implements PipelineProvider {
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
    const samples = representativeCorpusSample(blocks);
    const analyses: z.infer<typeof corpusAnalysisSchema>[] = [];
    await withStageProgress(async () => {
      for (const sampleBatch of chunksOf(samples, 4)) {
        try {
          analyses.push(await generateStructured(this.provider, {
            system: corpusAnalysisSystemPrompt(profile),
            prompt: corpusAnalysisPrompt(profile, sampleBatch),
            temperature: 0,
          }, corpusAnalysisSchema, 1));
        } catch {
          // A failed slice does not erase analyses already grounded in other documents.
        }
      }
    }, onWaiting);
    if (!analyses.length) {
      await onPhase?.("planning");
      return fallbackGenerationPlan(profile, blocks);
    }
    await onPhase?.("planning");
    const planMetadata = {
      version: "1.0" as const,
      outputLanguage: profile.outputLanguage ?? "en",
      researchGoal: profile.researchGoal,
      analyzedDocumentIds: [...new Set(blocks.map(block => block.documentId))],
      createdAt: new Date().toISOString(),
    };
    try {
      const generated = await withWaitingProgress(generateStructured(this.provider, {
        system: generationPlanSystemPrompt(profile),
        prompt: generationPlanPrompt(profile, analyses),
        temperature: 0,
      }, generationPlanOutputSchema, 1), onWaiting);
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
            ? "名称明确表示定律、定理、理论、模型、方法、公式、实验或现象时，必须归入对应语义类别。"
            : "Names that explicitly identify a law, theorem, theory, model, method, formula, experiment, or phenomenon must use the corresponding semantic category.",
        ],
      }), profile);
    }
  }

  async filterRelevant(profile: WikiProfile, plan: WikiGenerationPlan, blocks: DocumentBlock[], onWaiting?: WaitingProgressCallback) {
    if (this.provider instanceof DemoLLMProvider) return blocks;
    const keptIds = new Set<string>();
    await withStageProgress(async () => {
      for (const batch of chunksOf(blocks, 16)) {
        const evidenceMap = batch.map(block => ({ blockId: block.id, text: block.text.slice(0, 1_600) }));
        try {
          const output = await generateStructured(this.provider, {
            system: relevanceSystemPrompt(profile),
            prompt: relevancePrompt(profile, plan, evidenceMap),
            temperature: 0,
          }, relevanceSchema, 1);
          const suppliedIds = new Set(batch.map(block => block.id));
          const decidedIds = new Set<string>();
          for (const decision of output.decisions) {
            if (!suppliedIds.has(decision.blockId)) continue;
            decidedIds.add(decision.blockId);
            if (decision.keep && decision.relevanceScore >= 0.4) keptIds.add(decision.blockId);
          }
          // Missing decisions are retained: unreviewed evidence must not disappear silently.
          for (const block of batch) if (!decidedIds.has(block.id)) keptIds.add(block.id);
        } catch {
          for (const block of batch) keptIds.add(block.id);
        }
      }
    }, onWaiting);
    return blocks.filter(block => keptIds.has(block.id));
  }

  async extractKnowledge(profile: WikiProfile, plan: WikiGenerationPlan, blocks: DocumentBlock[], onWaiting?: WaitingProgressCallback) {
    if (this.provider instanceof DemoLLMProvider) return { entities: [], relations: [] };
    return withStageProgress(async () => {
      const aggregate: KnowledgeExtraction = { entities: [], relations: [] };
      for (const batch of chunksOf(blocks, 12)) {
        const evidenceMap = batch.map(block => ({ blockId: block.id, text: block.text.slice(0, 1_600) }));
        let output: KnowledgeExtraction;
        try {
          output = await generateStructured(this.provider, {
            system: extractionSystemPrompt(profile),
            prompt: extractionPrompt(profile, plan, evidenceMap),
            temperature: 0,
          }, extractionSchema, 1);
        } catch {
          continue;
        }
        if (!output.entities.length && evidenceMap.length) {
          try {
            output = await generateStructured(this.provider, {
              system: extractionSystemPrompt(profile),
              prompt: `${extractionPrompt(profile, plan, evidenceMap)}\nThe prior extraction was empty. Re-check named, evidence-backed knowledge without inventing facts.`,
              temperature: 0,
            }, extractionSchema, 1);
          } catch {
            continue;
          }
        }
        aggregate.entities.push(...output.entities);
        aggregate.relations.push(...output.relations);
      }
      ensurePlanCategoriesForEntities(plan, aggregate.entities);
      const categoryById = new Map(plan.categories.map(category => [category.id.normalize("NFKC").trim().toLocaleLowerCase(), category]));
      const classifiedTypes = new Map<string, string>();
      for (const entityBatch of chunksOf(aggregate.entities, 32)) {
        try {
          const result = await generateStructured(this.provider, {
            system: classificationSystemPrompt(profile),
            prompt: classificationPrompt(profile, plan, entityBatch.map(entity => ({
              name: entity.name, canonicalName: entity.canonicalName, summary: entity.summary,
              properties: entity.properties, proposedType: entity.type,
            }))),
            temperature: 0,
          }, classificationSchema, 1);
          for (const classification of result.classifications) {
            const category = categoryById.get(classification.categoryId.normalize("NFKC").trim().toLocaleLowerCase());
            if (category) classifiedTypes.set(classification.entityName.normalize("NFKC").trim().toLocaleLowerCase(), category.label);
          }
        } catch {
          // Extraction types remain available for deterministic plan mapping below.
        }
      }
      aggregate.entities = applyPlannedEntityTypes(plan, aggregate.entities.map(entity => ({
        ...entity,
        type: classifiedTypes.get(entity.name.normalize("NFKC").trim().toLocaleLowerCase()) ?? entity.type,
      })));
      return aggregate;
    }, onWaiting);
  }
}

export function getLlmProvider(): PipelineProvider {
  return new SafePipelineProvider(createLLMProvider());
}

import {
  normalizeEntityTypes,
  type DocumentBlock,
  type WikiCategory,
  type WikiCategoryRole,
  type WikiGenerationPlan,
  type WikiNode,
  type WikiProfile,
} from "../../shared/contracts.js";

const CATEGORY_DEFAULTS: Record<"en" | "zh", Record<WikiCategoryRole, Pick<WikiCategory, "id" | "label" | "definition">>> = {
  zh: {
    law: { id: "law", label: "定律", definition: "具有明确适用条件、描述稳定规律或基本关系的命名定律与定则。" },
    theorem: { id: "theorem", label: "定理", definition: "由前提与推理建立、具有明确结论的命名定理。" },
    theory: { id: "theory", label: "理论", definition: "用于系统解释现象、关系或机制的理论框架。" },
    model: { id: "model", label: "模型", definition: "用于表示、解释、模拟或预测对象与系统的模型。" },
    concept: { id: "concept", label: "概念", definition: "具有独立定义、但不属于更具体类别的核心概念。" },
    method: { id: "method", label: "方法", definition: "研究、计算、测量、分析或操作方法。" },
    formula: { id: "formula", label: "公式", definition: "具有独立用途的方程、表达式或计算公式。" },
    quantity: { id: "quantity", label: "指标", definition: "可测量、计算或比较的量、参数与指标。" },
    experiment: { id: "experiment", label: "实验", definition: "具有明确设置、步骤或目的的实验与测试。" },
    phenomenon: { id: "phenomenon", label: "现象", definition: "被观察、描述或解释的现象、效应与行为。" },
    person: { id: "person", label: "人物", definition: "与知识内容直接相关的人物或研究者。" },
    material: { id: "material", label: "材料", definition: "研究涉及的材料、物质、组分与样品。" },
    other: { id: "other", label: "其他", definition: "与目标高度相关但无法归入现有类别的知识实体。" },
  },
  en: {
    law: { id: "law", label: "Law", definition: "A named law or rule with explicit scope that describes a stable principle or relationship." },
    theorem: { id: "theorem", label: "Theorem", definition: "A named theorem with explicit premises, reasoning, and a defined conclusion." },
    theory: { id: "theory", label: "Theory", definition: "A theoretical framework used to explain phenomena, relationships, or mechanisms." },
    model: { id: "model", label: "Model", definition: "A model used to represent, explain, simulate, or predict an object or system." },
    concept: { id: "concept", label: "Concept", definition: "A core defined concept that does not belong to a more specific category." },
    method: { id: "method", label: "Method", definition: "A research, calculation, measurement, analysis, or operational method." },
    formula: { id: "formula", label: "Formula", definition: "An equation, expression, or calculation formula with an independent use." },
    quantity: { id: "quantity", label: "Quantity", definition: "A measurable or calculated quantity, parameter, or metric." },
    experiment: { id: "experiment", label: "Experiment", definition: "An experiment or test with a defined setup, procedure, or purpose." },
    phenomenon: { id: "phenomenon", label: "Phenomenon", definition: "An observed or explained phenomenon, effect, or behavior." },
    person: { id: "person", label: "Person", definition: "A person or researcher directly relevant to the knowledge content." },
    material: { id: "material", label: "Material", definition: "A material, substance, component, or sample studied in the corpus." },
    other: { id: "other", label: "Other", definition: "Goal-relevant knowledge that cannot be assigned to an existing category." },
  },
};

const unique = <T>(values: T[]) => [...new Set(values)];
const normalized = (value: string) => value.normalize("NFKC").trim().toLocaleLowerCase();

function qualityPolicy(profile?: WikiProfile) {
  switch (profile?.qualityPreference) {
    case "precision_first": return { relevanceThreshold: .6, entityThreshold: .72, relationThreshold: .8, criticalCoverageTarget: .9, maximumGenericRelationRatio: .05 };
    case "recall_first": return { relevanceThreshold: .3, entityThreshold: .5, relationThreshold: .68, criticalCoverageTarget: .95, maximumGenericRelationRatio: .15 };
    default: return { relevanceThreshold: .42, entityThreshold: .6, relationThreshold: .74, criticalCoverageTarget: .9, maximumGenericRelationRatio: .1 };
  }
}

function defaultFieldRules(profile: WikiProfile | undefined, plan: WikiGenerationPlan) {
  if (plan.fieldRules?.length) return plan.fieldRules;
  return unique([...(profile?.importantFields ?? []), ...plan.requiredKnowledge]).slice(0, 32).map((label, index) => ({
    id: `field-${index + 1}`, label, description: label,
    priority: index < Math.max(1, profile?.importantFields.length ?? 0) ? "critical" as const : "high" as const,
    valueType: "text" as const, unitRequired: false, evidenceRequired: profile?.evidenceRequired ?? true,
  }));
}

function defaultRelationRules(plan: WikiGenerationPlan) {
  const existing = plan.relationRules ?? [];
  const labels = new Set(existing.map(rule => normalized(rule.label)));
  const added = plan.relationTypes.filter(label => !labels.has(normalized(label))).map((label, index) => ({
    id: `relation-${existing.length + index + 1}`, label, definition: label,
    allowedSourceCategoryIds: [], allowedTargetCategoryIds: [], symmetric: false,
    requiresConditions: false, allowInferred: false,
  }));
  return [...existing, ...added];
}

function fallbackRelationTypes(profile: WikiProfile, language: "en" | "zh") {
  if (profile.preferredRelations.length) return profile.preferredRelations;
  // This is only used when the planning model is unavailable. It keeps an empty user preference
  // from becoming an instruction to build an edgeless Wiki; extraction still needs direct evidence.
  return language === "zh"
    ? ["定义", "应用于", "依赖于", "导致", "通过…测量"]
    : ["defines", "applies to", "depends on", "causes", "measured by"];
}

function normalizeRelationCategoryIds(planCategories: WikiCategory[], finalCategories: WikiCategory[], ids: string[]) {
  return unique(ids.flatMap(value => {
    const direct = finalCategories.find(category => [category.id, category.label].some(item => normalized(item) === normalized(value)));
    if (direct) return [direct.id];
    const original = planCategories.find(category => [category.id, category.label].some(item => normalized(item) === normalized(value)));
    const byRole = original && finalCategories.find(category => category.role === original.role);
    return byRole ? [byRole.id] : [];
  }));
}

export interface CorpusSample {
  documentId: string;
  blocks: Array<{ blockId: string; page: number; section?: string; blockType: DocumentBlock["blockType"]; text: string }>;
}

/** Samples every document at distributed positions so planning reflects the corpus, not only its first pages. */
export function representativeCorpusSample(blocks: DocumentBlock[], blocksPerDocument = 8): CorpusSample[] {
  const byDocument = new Map<string, DocumentBlock[]>();
  for (const block of blocks) byDocument.set(block.documentId, [...(byDocument.get(block.documentId) ?? []), block]);
  return [...byDocument.entries()].map(([documentId, documentBlocks]) => {
    const headings = documentBlocks.filter(block => block.blockType === "heading").slice(0, 3);
    const remaining = Math.max(1, blocksPerDocument - headings.length);
    const distributed = Array.from({ length: Math.min(remaining, documentBlocks.length) }, (_, index) => {
      const position = Math.round(index * (documentBlocks.length - 1) / Math.max(remaining - 1, 1));
      return documentBlocks[position];
    });
    const selectedIds = unique([...headings, ...distributed].map(block => block.id));
    return {
      documentId,
      blocks: selectedIds
        .map(id => documentBlocks.find(block => block.id === id))
        .filter((block): block is DocumentBlock => Boolean(block))
        .map(block => ({
          blockId: block.id, page: block.page, section: block.section, blockType: block.blockType,
          text: block.text.slice(0, 1_200),
        })),
    };
  });
}

function requiredCategory(language: "en" | "zh", role: WikiCategoryRole): WikiCategory {
  return { ...CATEGORY_DEFAULTS[language][role], role, inclusionExamples: [], exclusionExamples: [] };
}

/**
 * A non-empty user type list is a closed label contract, but it is not a request to
 * discard the corpus-specific meaning the planning worker has learned for those labels.
 * Matching is by the user's label (or an equivalent generated id), never by a node name.
 */
function profileCategories(
  profile: WikiProfile,
  language: "en" | "zh",
  plannedCategories: WikiCategory[] = [],
): WikiCategory[] {
  const usedIds = new Set<string>();
  return normalizeEntityTypes(profile.entityTypes).map(label => {
    const planned = plannedCategories.find(category => normalized(category.label) === normalized(label))
      ?? plannedCategories.find(category => normalized(category.id) === normalized(label));
    // Roles remain presentation/validation metadata. For arbitrary user labels the plan's
    // evidence-informed role is preferable to a generic "other" default.
    const role = roleFromType(label) ?? planned?.role ?? "other";
    const defaultId = CATEGORY_DEFAULTS[language][role].id;
    const requestedId = planned?.id || defaultId;
    let id = requestedId;
    let suffix = 2;
    while (usedIds.has(normalized(id))) id = `${requestedId}-${suffix++}`;
    usedIds.add(normalized(id));
    return {
      id,
      label,
      role,
      definition: planned?.definition
        ?? (language === "zh" ? `用户明确要求保留的“${label}”类知识。` : `User-requested ${label} knowledge.`),
      inclusionExamples: planned?.inclusionExamples ?? [],
      exclusionExamples: planned?.exclusionExamples ?? [],
    };
  });
}

/** Keeps user-declared ontology classes authoritative while preserving plan-specific meanings. */
export function normalizeGenerationPlan(plan: WikiGenerationPlan, profile?: WikiProfile): WikiGenerationPlan {
  const requestedEntityTypes = profile ? normalizeEntityTypes(profile.entityTypes) : [];
  const strictEntityTypes = requestedEntityTypes.length > 0;
  const categories: WikiCategory[] = profile
    ? profileCategories({ ...profile, entityTypes: requestedEntityTypes }, plan.outputLanguage, plan.categories)
    : [];
  const seenIds = new Set<string>();
  const seenLabels = new Set<string>();
  for (const category of categories) {
    seenIds.add(normalized(category.id));
    seenLabels.add(normalized(category.label));
  }
  // A non-empty user type list is a closed ontology. Corpus suggestions can still inform
  // definitions, fields, relations, and the semantics of matching labels, but they must
  // never add or remove top-level types.
  for (const category of strictEntityTypes ? [] : plan.categories) {
    const idKey = normalized(category.id);
    const labelKey = normalized(category.label);
    if (!idKey || seenIds.has(idKey) || seenLabels.has(labelKey)) continue;
    // Keep corpus-specific labels and definitions intact. `role` is deliberately not used to
    // collapse categories: two different domain concepts may share the same broad role.
    const broadCategory = category;
    categories.push({
      ...broadCategory,
      inclusionExamples: category.inclusionExamples,
      exclusionExamples: category.exclusionExamples,
    });
    seenIds.add(normalized(broadCategory.id));
    seenLabels.add(normalized(broadCategory.label));
  }
  if (!categories.length) {
    categories.push(requiredCategory(plan.outputLanguage, "concept"));
  }
  if (strictEntityTypes && categories.length > 16) {
    throw new Error("The user-specified knowledge type list exceeds the 16-category Wiki limit");
  }
  const normalizedPlan = {
    ...plan,
    version: "2.0" as const,
    requiredKnowledge: unique([...(profile?.importantFields ?? []), ...plan.requiredKnowledge]).slice(0, 24),
    relationTypes: unique([...(profile?.preferredRelations ?? []), ...plan.relationTypes]).slice(0, 24),
    categories: strictEntityTypes ? categories : categories.slice(0, 16),
    entityTypePolicy: strictEntityTypes ? "strict" as const : plan.entityTypePolicy ?? "open" as const,
    detectedPreset: profile?.preset && profile.preset !== "auto" ? profile.preset : plan.detectedPreset ?? "auto",
    unitOfAnalysis: profile?.unitOfAnalysis || plan.unitOfAnalysis || "",
    targetQuestions: unique([...(profile?.targetQuestions ?? []), ...(plan.targetQuestions ?? [])]).slice(0, 20),
    qualityPolicy: plan.qualityPolicy ?? qualityPolicy(profile),
  };
  const relationRules = defaultRelationRules(normalizedPlan).map(rule => ({
    ...rule,
    allowedSourceCategoryIds: normalizeRelationCategoryIds(plan.categories, normalizedPlan.categories, rule.allowedSourceCategoryIds),
    allowedTargetCategoryIds: normalizeRelationCategoryIds(plan.categories, normalizedPlan.categories, rule.allowedTargetCategoryIds),
  }));
  return {
    ...normalizedPlan,
    fieldRules: defaultFieldRules(profile, normalizedPlan),
    relationRules,
  };
}

const TYPE_ROLE_ALIASES: Record<WikiCategoryRole, string[]> = {
  law: ["law", "rule", "定律", "定则"],
  theorem: ["theorem", "定理"],
  theory: ["theory", "理论"],
  model: ["model", "模型"],
  concept: ["concept", "notion", "principle", "概念", "原理"],
  method: ["method", "algorithm", "technique", "方法", "算法", "技术"],
  formula: ["formula", "equation", "expression", "公式", "方程", "表达式"],
  quantity: ["quantity", "metric", "parameter", "indicator", "物理量", "指标", "参数"],
  experiment: ["experiment", "test", "实验", "试验", "测试"],
  phenomenon: ["phenomenon", "effect", "behavior", "现象", "效应", "行为"],
  person: ["person", "researcher", "人物", "研究者"],
  material: ["material", "substance", "sample", "材料", "物质", "样品"],
  other: ["other", "其他"],
};

function roleFromType(type: string | undefined): WikiCategoryRole | undefined {
  if (!type) return undefined;
  const value = normalized(type);
  return (Object.entries(TYPE_ROLE_ALIASES) as Array<[WikiCategoryRole, string[]]>)
    .find(([, aliases]) => aliases.some(alias => value === normalized(alias)))?.[0];
}

type ClassifiableEntity = {
  name: string;
  canonicalName?: string;
  type?: string;
  summary?: string;
  properties?: Record<string, string | number>;
};

/** Resolves only an identifier emitted against the current controlled plan, never its meaning. */
export function categoryForIdentifier(plan: WikiGenerationPlan, identifier: string | undefined): WikiCategory | undefined {
  if (!identifier) return undefined;
  const key = normalized(identifier);
  return plan.categories.find(category => normalized(category.id) === key || normalized(category.label) === key);
}

export function categoryForEntity(plan: WikiGenerationPlan, entity: ClassifiableEntity): WikiCategory {
  return categoryForIdentifier(plan, entity.type) ?? plan.categories[0];
}

/** Converts provider-written types into labels from the validated project plan. */
export function applyPlannedEntityTypes<T extends ClassifiableEntity>(
  plan: WikiGenerationPlan,
  entities: T[],
): T[] {
  return entities.map(entity => ({ ...entity, type: categoryForEntity(plan, entity).label }));
}

export function applyPlanToWikiNodes(plan: WikiGenerationPlan, nodes: WikiNode[]): void {
  for (const node of nodes) {
    const category = categoryForIdentifier(plan, node.type)
      ?? categoryForIdentifier(plan, node.classification?.categoryId)
      ?? plan.categories[0];
    if (category) node.type = category.label;
    // Classification is now a single extraction/classification result, not a persisted review
    // queue. Drop decisions from older snapshots while retaining the normalized node type.
    delete node.classification;
  }
}

export function fallbackGenerationPlan(profile: WikiProfile, blocks: DocumentBlock[]): WikiGenerationPlan {
  const language = profile.outputLanguage ?? "en";
  return normalizeGenerationPlan({
    version: "2.0", outputLanguage: language, researchGoal: profile.researchGoal,
    corpusSummary: language === "zh" ? "基于当前文档与研究目标生成的保守分类计划。" : "A conservative plan based on the current documents and research goal.",
    themes: [], requiredKnowledge: profile.importantFields, categories: [],
    relationTypes: fallbackRelationTypes(profile, language), classificationRules: [],
    detectedPreset: profile.preset ?? "auto", unitOfAnalysis: profile.unitOfAnalysis ?? "", targetQuestions: profile.targetQuestions ?? [],
    fieldRules: [], relationRules: [], qualityPolicy: qualityPolicy(profile),
    analyzedDocumentIds: unique(blocks.map(block => block.documentId)), createdAt: new Date().toISOString(),
  }, profile);
}

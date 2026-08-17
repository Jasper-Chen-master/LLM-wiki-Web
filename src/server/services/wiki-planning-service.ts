import type {
  DocumentBlock,
  WikiCategory,
  WikiCategoryRole,
  WikiGenerationPlan,
  WikiNode,
  WikiProfile,
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

function profileCategories(profile: WikiProfile, language: "en" | "zh"): WikiCategory[] {
  const roleCounts = new Map<WikiCategoryRole, number>();
  return unique(profile.entityTypes.map(type => type.trim()).filter(Boolean)).map(label => {
    const role = roleFromType(label) ?? "other";
    const count = (roleCounts.get(role) ?? 0) + 1;
    roleCounts.set(role, count);
    const base = CATEGORY_DEFAULTS[language][role];
    return {
      id: count === 1 ? base.id : `${base.id}-${count}`,
      label,
      role,
      definition: language === "zh" ? `用户明确要求保留的“${label}”类知识。` : `User-requested ${label} knowledge.`,
      inclusionExamples: [], exclusionExamples: [],
    };
  });
}

/** Keeps user-declared ontology classes authoritative and collapses AI topics into broad roles. */
export function normalizeGenerationPlan(plan: WikiGenerationPlan, profile?: WikiProfile): WikiGenerationPlan {
  const categories: WikiCategory[] = profile ? profileCategories(profile, plan.outputLanguage) : [];
  const seenIds = new Set<string>();
  const seenLabels = new Set<string>();
  for (const category of categories) {
    seenIds.add(normalized(category.id));
    seenLabels.add(normalized(category.label));
  }
  for (const category of plan.categories) {
    const idKey = normalized(category.id);
    const labelKey = normalized(category.label);
    if (!idKey || seenIds.has(idKey) || seenLabels.has(labelKey)) continue;
    // AI may discover broad missing roles, but corpus topics and individual entities are not ontology classes.
    if (category.role === "other" || categories.some(existing => existing.role === category.role)) continue;
    const broadCategory = requiredCategory(plan.outputLanguage, category.role);
    categories.push({
      ...broadCategory,
      inclusionExamples: category.inclusionExamples,
      exclusionExamples: category.exclusionExamples,
    });
    seenIds.add(normalized(broadCategory.id));
    seenLabels.add(normalized(broadCategory.label));
  }
  for (const role of ["law", "concept"] as const) {
    if (categories.some(category => category.role === role)) continue;
    const category = requiredCategory(plan.outputLanguage, role);
    if (categories.length >= 16) categories.pop();
    if (!seenIds.has(category.id)) categories.push(category);
  }
  return {
    ...plan,
    requiredKnowledge: unique([...(profile?.importantFields ?? []), ...plan.requiredKnowledge]).slice(0, 24),
    relationTypes: unique([...(profile?.preferredRelations ?? []), ...plan.relationTypes]).slice(0, 24),
    categories: categories.slice(0, 16),
  };
}

const ROLE_PATTERNS: Array<[WikiCategoryRole, RegExp]> = [
  ["law", /定律|定则|\b(?:law|laws|rule|rules)\b/iu],
  ["theorem", /定理|\btheorems?\b/iu],
  ["theory", /理论|\btheor(?:y|ies)\b/iu],
  ["model", /模型|\bmodels?\b/iu],
  ["method", /(?:方法|算法|技术|分析法|method|algorithm|technique|analysis)\b|(?:方法|算法|技术|分析法|分析)$/iu],
  ["formula", /(?:公式|方程|表达式|formula|equation|expression)\b|(?:公式|方程|表达式)$/iu],
  ["quantity", /(?:加速度|速度|动量|角动量|能量|质量|时间|位移|距离|频率|波长|振幅|温度|压力|电压|电流|功率|密度|长度|面积|体积|quantity|metric|parameter)$/iu],
  ["experiment", /(?:实验|试验|测试|experiment|test)\b|(?:实验|试验|测试)$/iu],
  ["phenomenon", /(?:现象|效应|行为|phenomenon|effect|behavior)\b|(?:现象|效应)$/iu],
];

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

function roleFromName(name: string): WikiCategoryRole | undefined {
  return ROLE_PATTERNS.find(([, pattern]) => pattern.test(name))?.[0];
}

function roleFromType(type: string | undefined): WikiCategoryRole | undefined {
  if (!type) return undefined;
  const value = normalized(type);
  return (Object.entries(TYPE_ROLE_ALIASES) as Array<[WikiCategoryRole, string[]]>)
    .find(([, aliases]) => aliases.some(alias => value === normalized(alias)))?.[0];
}

export function categoryForEntity(plan: WikiGenerationPlan, entity: { name: string; canonicalName?: string; type?: string }): WikiCategory {
  const name = entity.canonicalName ?? entity.name;
  const forcedRole = roleFromName(name);
  const exact = plan.categories.find(category =>
    normalized(category.id) === normalized(entity.type ?? "") || normalized(category.label) === normalized(entity.type ?? ""));
  const inferredRole = forcedRole ?? exact?.role ?? roleFromType(entity.type) ?? "concept";
  return plan.categories.find(category => category.role === inferredRole)
    ?? plan.categories.find(category => category.role === "concept")
    ?? plan.categories[0];
}

export function ensurePlanCategoriesForEntities(
  plan: WikiGenerationPlan,
  entities: Array<{ name: string; canonicalName?: string; type?: string }>,
): void {
  const roles = unique(entities.flatMap(entity => {
    const name = entity.canonicalName ?? entity.name;
    return [roleFromName(name) ?? roleFromType(entity.type)].filter((role): role is WikiCategoryRole => Boolean(role));
  }));
  for (const role of roles) {
    if (plan.categories.some(category => category.role === role)) continue;
    if (plan.categories.length >= 16) {
      const expendableIndex = plan.categories.findIndex(category => category.role === "other");
      if (expendableIndex < 0) continue;
      plan.categories.splice(expendableIndex, 1);
    }
    plan.categories.push(requiredCategory(plan.outputLanguage, role));
  }
}

/** Converts provider-written free-form types into labels from the validated project plan. */
export function applyPlannedEntityTypes<T extends { name: string; canonicalName?: string; type?: string }>(plan: WikiGenerationPlan, entities: T[]): T[] {
  ensurePlanCategoriesForEntities(plan, entities);
  return entities.map(entity => ({ ...entity, type: categoryForEntity(plan, entity).label }));
}

export function applyPlanToWikiNodes(plan: WikiGenerationPlan, nodes: WikiNode[]): void {
  ensurePlanCategoriesForEntities(plan, nodes.map(node => ({ name: node.displayName, canonicalName: node.canonicalName, type: node.type })));
  for (const node of nodes) node.type = categoryForEntity(plan, { name: node.displayName, canonicalName: node.canonicalName, type: node.type }).label;
}

export function fallbackGenerationPlan(profile: WikiProfile, blocks: DocumentBlock[]): WikiGenerationPlan {
  const language = profile.outputLanguage ?? "en";
  return normalizeGenerationPlan({
    version: "1.0", outputLanguage: language, researchGoal: profile.researchGoal,
    corpusSummary: language === "zh" ? "基于当前文档与研究目标生成的保守分类计划。" : "A conservative plan based on the current documents and research goal.",
    themes: [], requiredKnowledge: profile.importantFields, categories: [],
    relationTypes: profile.preferredRelations, classificationRules: [],
    analyzedDocumentIds: unique(blocks.map(block => block.documentId)), createdAt: new Date().toISOString(),
  }, profile);
}

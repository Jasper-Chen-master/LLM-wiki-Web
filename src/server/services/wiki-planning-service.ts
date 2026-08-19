import type {
  DocumentBlock,
  CandidateExtractionContract,
  NodeCreationPolicy,
  WikiCategory,
  WikiCategoryRole,
  WikiClassificationDecision,
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

function qualityPolicy(profile?: WikiProfile) {
  switch (profile?.qualityPreference) {
    case "precision_first": return { relevanceThreshold: .6, entityThreshold: .72, relationThreshold: .8, criticalCoverageTarget: .9, maximumGenericRelationRatio: .05 };
    case "recall_first": return { relevanceThreshold: .3, entityThreshold: .5, relationThreshold: .68, criticalCoverageTarget: .95, maximumGenericRelationRatio: .15 };
    default: return { relevanceThreshold: .42, entityThreshold: .6, relationThreshold: .74, criticalCoverageTarget: .9, maximumGenericRelationRatio: .1 };
  }
}

function nodeCreationPolicy(profile?: WikiProfile): NodeCreationPolicy {
  const thresholds = profile?.qualityPreference === "precision_first"
    ? { publishThreshold: .68, reviewThreshold: .42 }
    : profile?.qualityPreference === "recall_first"
      ? { publishThreshold: .48, reviewThreshold: .28 }
      : { publishThreshold: .58, reviewThreshold: .34 };
  return {
    version: "1.0", ...thresholds, minimumEvidenceCount: 1,
    requireIndependentMeaning: true, retainReviewCandidates: true,
  };
}

function candidateExtractionContract(profile: WikiProfile | undefined, plan: WikiGenerationPlan): CandidateExtractionContract {
  const zh = plan.outputLanguage === "zh";
  return {
    version: "1.0",
    analysisUnit: profile?.unitOfAnalysis || plan.unitOfAnalysis || (zh ? "可跨来源复用、可由证据独立说明的知识单元" : "an evidence-supported knowledge unit reusable across sources"),
    atomicityRules: zh ? [
      "一条 Evidence Claim 只能表达一个可由当前 Block 直接支持的定义、规律、公式、方法、条件、发现或示例。",
      "不要把通用概念、具体实例、适用条件和推论混入同一条 Claim；应分别记录并通过后续目录关联。",
      "没有可直接定位的证据时不得创建 Claim，也不得用常识补全论文或教材未陈述的内容。",
    ] : [
      "One Evidence Claim expresses exactly one definition, principle, formula, method, condition, finding, or example directly supported by its current block.",
      "Do not mix a general concept, a concrete instance, applicability conditions, and an implication in one claim; record them separately for later cataloging.",
      "Do not create a claim without directly locatable support or fill gaps with outside knowledge.",
    ],
    attachInsteadOfCreateRules: zh ? [
      "实例、习题情境、符号约定、适用条件、反例、常见误解或同一概念的重复表述默认附着到已有概念，不自动成为独立 Candidate。",
      "只有当该信息在当前分析单元下可被独立解释、检索或跨来源复用时，才建议创建 Candidate。",
    ] : [
      "Examples, problem contexts, notation conventions, applicability conditions, counterexamples, misconceptions, and repeated wording attach to a concept by default instead of creating a separate Candidate.",
      "Suggest a Candidate only when the item can be independently explained, retrieved, or reused across sources for this analysis unit.",
    ],
    exclusionRules: unique([...(profile?.exclude ?? []), ...(zh ? ["行政信息、目录、无实质内容的参考文献"] : ["administrative text, tables of contents, references without substantive content"])]).slice(0, 12),
    requiredClaimKinds: unique([...(profile?.importantFields ?? []), ...plan.requiredKnowledge]).slice(0, 16),
    requireBlockCoverage: true,
  };
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
    // In auto/custom mode the corpus may define reusable domain classes represented by the
    // generic `other` role (company, clause, component, claim, sample...). User-provided types
    // remain authoritative when present; semantic built-ins are still deduplicated by role.
    if (category.role !== "other" && categories.some(existing => existing.role === category.role)) continue;
    const broadCategory = category.role === "other" ? category : requiredCategory(plan.outputLanguage, category.role);
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
  const normalizedPlan = {
    ...plan,
    version: "2.0" as const,
    requiredKnowledge: unique([...(profile?.importantFields ?? []), ...plan.requiredKnowledge]).slice(0, 24),
    relationTypes: unique([...(profile?.preferredRelations ?? []), ...plan.relationTypes]).slice(0, 24),
    categories: categories.slice(0, 16),
    detectedPreset: profile?.preset && profile.preset !== "auto" ? profile.preset : plan.detectedPreset ?? "auto",
    unitOfAnalysis: profile?.unitOfAnalysis || plan.unitOfAnalysis || "",
    targetQuestions: unique([...(profile?.targetQuestions ?? []), ...(plan.targetQuestions ?? [])]).slice(0, 20),
    qualityPolicy: plan.qualityPolicy ?? qualityPolicy(profile),
    nodeCreationPolicy: plan.nodeCreationPolicy ?? nodeCreationPolicy(profile),
    candidateExtractionContract: plan.candidateExtractionContract ?? candidateExtractionContract(profile, plan),
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

const RELATION_LIKE_NAME = /(?:关系|关联|相关性|变化率|比例关系|依赖关系|relationship|relation|correlation|rate of change)$/iu;
const FORMULA_SIGNAL = /(?:公式|方程|表达式|等式|formula|equation|expression|\b[a-zα-ω]\s*=|[=∑∫∂])/iu;
const NAMED_IDENTITY_ROLES = new Set<WikiCategoryRole>(["law", "theorem", "theory"]);

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

export interface ClassificationCandidate {
  categoryId: string;
  semanticRole: WikiCategoryRole;
  confidence: number;
  explicitIdentity: boolean;
  identityEvidence?: string;
  identityEvidenceVerified?: boolean;
  alternatives?: string[];
  semanticExplanation?: string;
  decisionFactors?: string[];
  counterEvidence?: string;
  reason: string;
  needsReview?: boolean;
  source?: "llm" | "review";
}

type ClassifiableEntity = {
  name: string;
  canonicalName?: string;
  type?: string;
  summary?: string;
  properties?: Record<string, string | number>;
};

const categoryByRole = (plan: WikiGenerationPlan, role: WikiCategoryRole) =>
  plan.categories.find(category => category.role === role);

function contentFallbackRole(entity: ClassifiableEntity): WikiCategoryRole {
  const name = entity.canonicalName ?? entity.name;
  const context = [name, entity.summary, ...Object.keys(entity.properties ?? {}), ...Object.values(entity.properties ?? {}).map(String)].filter(Boolean).join(" ");
  if (FORMULA_SIGNAL.test(context)) return "formula";
  const providerRole = roleFromType(entity.type);
  if (providerRole && !NAMED_IDENTITY_ROLES.has(providerRole)) return providerRole;
  return "concept";
}

function safeFallbackRole(entity: ClassifiableEntity): WikiCategoryRole {
  return roleFromName(entity.canonicalName ?? entity.name) ?? contentFallbackRole(entity);
}

/**
 * Resolves an AI classification as an auditable proposal rather than ground truth. Named laws,
 * theorems and theories need positive identity evidence; a mathematical relationship alone can
 * therefore never be promoted to a law merely because an extraction model proposed that label.
 */
export function resolveEntityClassification(
  plan: WikiGenerationPlan,
  entity: ClassifiableEntity,
  candidate?: ClassificationCandidate,
): { category: WikiCategory; decision: WikiClassificationDecision } {
  const name = entity.canonicalName ?? entity.name;
  const message = (en: string, zh: string) => plan.outputLanguage === "zh" ? zh : en;
  const explicitRole = roleFromName(name);
  const fallbackRole = safeFallbackRole(entity);
  const fallbackCategory = categoryByRole(plan, fallbackRole)
    ?? categoryByRole(plan, "concept")
    ?? plan.categories[0];

  if (!candidate) {
    const category = explicitRole ? categoryByRole(plan, explicitRole) ?? fallbackCategory : fallbackCategory;
    const proposedTypeRole = roleFromType(entity.type);
    const safelyCorrected = !explicitRole && Boolean(proposedTypeRole && proposedTypeRole !== category.role);
    return {
      category,
      decision: {
        semanticRole: category.role, categoryId: category.id, confidence: explicitRole ? .55 : .45,
        status: safelyCorrected ? "corrected" : "needs_review", source: explicitRole ? "lexical" : "fallback",
        reason: safelyCorrected
          ? message("An unsafe provider type conflicted with the entity's structured content and was conservatively corrected.", "提取阶段给出的类别与结构化内容冲突，已进行保守纠正。")
          : message(
            "This is a provisional surface-level classification; source-context understanding is required before acceptance.",
            "当前仅为表层信号产生的临时分类，必须结合原文语境完成语义判断后才能确认。",
          ),
      },
    };
  }

  const proposedCategory = plan.categories.find(category => normalized(category.id) === normalized(candidate.categoryId));
  const proposedRole = proposedCategory?.role ?? candidate.semanticRole;
  const positiveNamedIdentity = !NAMED_IDENTITY_ROLES.has(proposedRole)
    || Boolean(candidate.explicitIdentity && candidate.identityEvidenceVerified);
  const relationContradiction = RELATION_LIKE_NAME.test(name) && NAMED_IDENTITY_ROLES.has(proposedRole) && !positiveNamedIdentity;
  const invalidNamedIdentity = NAMED_IDENTITY_ROLES.has(proposedRole) && !positiveNamedIdentity;
  const lowConfidence = candidate.confidence < .72 || Boolean(candidate.needsReview);
  const nameConflict = Boolean(explicitRole && explicitRole !== proposedRole);

  if (!proposedCategory || relationContradiction || invalidNamedIdentity) {
    const semanticFallbackRole = contentFallbackRole(entity);
    const semanticFallbackCategory = categoryByRole(plan, semanticFallbackRole)
      ?? categoryByRole(plan, "concept")
      ?? plan.categories[0];
    const needsReview = invalidNamedIdentity && semanticFallbackRole === "concept";
    return {
      category: semanticFallbackCategory,
      decision: {
        semanticRole: semanticFallbackCategory.role, categoryId: semanticFallbackCategory.id,
        confidence: candidate.confidence,
        status: needsReview ? "needs_review" : "corrected", source: "fallback",
        reason: relationContradiction
          ? message("A relationship or rate-of-change statement is not a named law without verified identity evidence.", "关系或变化率陈述在缺少可验证的命名证据时不能归为定律。")
          : invalidNamedIdentity
            ? message(`The proposed ${proposedRole} identity was not supported by a verifiable source excerpt.`, `原文摘录不足以证明候选项属于“${proposedCategory?.label ?? proposedRole}”。`)
            : message("The proposed category is outside the controlled plan; a safe semantic fallback was used.", "候选类别不在受控方案中，已使用安全的语义回退类别。"),
        semanticExplanation: candidate.semanticExplanation, decisionFactors: candidate.decisionFactors,
        identityEvidence: candidate.identityEvidence, proposedCategoryId: candidate.categoryId,
        alternatives: candidate.alternatives,
      },
    };
  }

  const category = proposedCategory;
  const unresolvedNameConflict = nameConflict && candidate.source !== "review";
  return {
    category,
    decision: {
      semanticRole: category.role, categoryId: category.id,
      confidence: candidate.confidence,
      status: lowConfidence || unresolvedNameConflict ? "needs_review" : "accepted",
      source: candidate.source ?? "llm",
      reason: unresolvedNameConflict
        ? message("The name suggests another category, so the semantic conclusion requires independent review.", "名称表层含义与语义判断不一致，需要独立复核后才能确认。")
        : candidate.reason,
      semanticExplanation: candidate.semanticExplanation, decisionFactors: candidate.decisionFactors,
      identityEvidence: candidate.identityEvidence, proposedCategoryId: candidate.categoryId,
      alternatives: candidate.alternatives,
    },
  };
}

export function categoryForEntity(plan: WikiGenerationPlan, entity: ClassifiableEntity): WikiCategory {
  return resolveEntityClassification(plan, entity).category;
}

export function ensurePlanCategoriesForEntities(
  plan: WikiGenerationPlan,
  entities: Array<{ name: string; canonicalName?: string; type?: string }>,
): void {
  if (plan.frozen) return;
  const roles = unique(entities.flatMap(entity => {
    const name = entity.canonicalName ?? entity.name;
    const role = roleFromName(name) ?? safeFallbackRole(entity);
    return [role].filter((value): value is WikiCategoryRole => Boolean(value));
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
export function applyPlannedEntityTypes<T extends ClassifiableEntity & { classificationCandidate?: ClassificationCandidate }>(
  plan: WikiGenerationPlan,
  entities: T[],
): Array<T & { classification: WikiClassificationDecision }> {
  ensurePlanCategoriesForEntities(plan, entities);
  return entities.map(entity => {
    const resolved = resolveEntityClassification(plan, entity, entity.classificationCandidate);
    return { ...entity, type: resolved.category.label, classification: resolved.decision };
  });
}

export function applyPlanToWikiNodes(plan: WikiGenerationPlan, nodes: WikiNode[]): void {
  ensurePlanCategoriesForEntities(plan, nodes.map(node => ({ name: node.displayName, canonicalName: node.canonicalName, type: node.type })));
  for (const node of nodes) {
    const prior = node.classification;
    const priorCandidate: ClassificationCandidate | undefined = prior ? {
      categoryId: prior.categoryId, semanticRole: prior.semanticRole, confidence: prior.confidence,
      explicitIdentity: Boolean(prior.identityEvidence), identityEvidence: prior.identityEvidence,
      identityEvidenceVerified: Boolean(prior.identityEvidence), alternatives: prior.alternatives,
      semanticExplanation: prior.semanticExplanation, decisionFactors: prior.decisionFactors,
      reason: prior.reason, needsReview: prior.status === "needs_review",
      source: prior.source === "review" ? "review" : "llm",
    } : undefined;
    const resolved = resolveEntityClassification(plan, {
      name: node.displayName, canonicalName: node.canonicalName, type: node.type,
      summary: node.summary, properties: node.properties,
    }, priorCandidate);
    node.type = resolved.category.label;
    node.classification = resolved.decision;
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

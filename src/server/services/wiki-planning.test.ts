import { describe, expect, it } from "vitest";
import type { DocumentBlock, WikiGenerationPlan, WikiProfile } from "../../shared/contracts.js";
import {
  applyPlannedEntityTypes,
  fallbackGenerationPlan,
  normalizeGenerationPlan,
  representativeCorpusSample,
  resolveEntityClassification,
} from "./wiki-planning-service.js";

const plan = (language: "en" | "zh" = "zh"): WikiGenerationPlan => normalizeGenerationPlan({
  version: "1.0",
  outputLanguage: language,
  researchGoal: language === "zh" ? "理解经典力学" : "Understand classical mechanics",
  corpusSummary: language === "zh" ? "经典力学课程材料" : "Classical mechanics course material",
  themes: [language === "zh" ? "运动定律" : "laws of motion"],
  requiredKnowledge: [],
  categories: [
    {
      id: "formula", label: language === "zh" ? "公式" : "Formula", role: "formula",
      definition: language === "zh" ? "数学表达式" : "Mathematical expression",
      inclusionExamples: [], exclusionExamples: [],
    },
    {
      id: "concept", label: language === "zh" ? "概念" : "Concept", role: "concept",
      definition: language === "zh" ? "一般概念" : "General concept",
      inclusionExamples: [], exclusionExamples: [],
    },
  ],
  relationTypes: [], classificationRules: [], analyzedDocumentIds: ["doc-a"],
  detectedPreset: "course", unitOfAnalysis: "concept", targetQuestions: [], fieldRules: [], relationRules: [],
  createdAt: "2026-08-17T00:00:00.000Z",
});

const academicProfile: WikiProfile = {
  version: "1.0",
  researchGoal: "从学术论文或课件中提取核心概念、方法、证据与结论，并连接为知识结构。",
  domain: "学术研究",
  entityTypes: ["概念", "方法", "理论", "实验", "指标", "公式"],
  importantFields: ["定义", "证据", "结论"],
  preferredRelations: ["推导", "证明", "应用", "对比", "导致"],
  exclude: ["通用背景", "无关方法", "重复描述"],
  extractNumericData: true, preserveUnits: true, extractTables: false, evidenceRequired: true,
  notes: "", outputLanguage: "zh",
};

describe("Wiki generation planning", () => {
  it("does not force course-only categories into every Wiki mode", () => {
    expect(plan("zh").categories.some(category => category.role === "law")).toBe(false);
  });

  it("treats an empty relation preference as AI freedom rather than an edgeless Wiki", () => {
    const fallback = fallbackGenerationPlan({
      ...academicProfile,
      entityTypes: [], importantFields: [], preferredRelations: [],
    }, []);
    expect(fallback.relationTypes).toEqual(expect.arrayContaining(["定义", "应用于"]));
    expect(fallback.relationRules).not.toHaveLength(0);
  });

  it("forces Newton's three laws into the law category despite provider type drift", () => {
    const entities = applyPlannedEntityTypes(plan("zh"), [
      { name: "牛顿第一定律", type: "概念" },
      { name: "牛顿第二定律", type: "公式" },
      { name: "牛顿第三定律", type: "理论" },
    ]);
    expect(entities.map(entity => entity.type)).toEqual(["定律", "定律", "定律"]);
  });

  it("applies general unambiguous semantic categories beyond the Newton example", () => {
    const entities = applyPlannedEntityTypes(plan("zh"), [
      { name: "开普勒第一定律", type: "概念" },
      { name: "勾股定理", type: "理论" },
      { name: "标准模型", type: "概念" },
      { name: "有限元方法", type: "概念" },
      { name: "薛定谔方程", type: "概念" },
      { name: "双缝实验", type: "概念" },
      { name: "光电效应", type: "概念" },
    ]);
    expect(entities.map(entity => entity.type)).toEqual([
      "定律", "定理", "模型", "方法", "公式", "实验", "现象",
    ]);
  });

  it("does not force an ambiguous principle into the law category", () => {
    const [entity] = applyPlannedEntityTypes(plan("zh"), [
      { name: "惯性原理", type: "概念" },
    ]);
    expect(entity.type).toBe("概念");
  });

  it("does not classify a rate-of-change relationship as a law", () => {
    const [entity] = applyPlannedEntityTypes(plan("zh"), [{
      name: "力矩与角动量变化率关系",
      type: "定律",
      summary: "合外力矩等于角动量对时间的变化率。",
      properties: { 公式: "τ_ext = dL/dt" },
    }]);
    expect(entity.type).toBe("公式");
    expect(entity.classification.status).toBe("corrected");
  });

  it("requires verified source identity before accepting an AI law proposal", () => {
    const generated = plan("zh");
    applyPlannedEntityTypes(generated, [{ name: "示例命名定律", type: "概念" }]);
    const entity = {
      name: "输入与输出变化率关系",
      summary: "描述两个量之间的导数关系。",
      properties: { 表达式: "dy/dt = kx" },
    };
    const rejected = resolveEntityClassification(generated, entity, {
      categoryId: "law", semanticRole: "law", confidence: .98, explicitIdentity: true,
      identityEvidence: "这是一个定律", identityEvidenceVerified: false,
      reason: "模型认为它很重要", source: "llm",
    });
    expect(rejected.category.role).toBe("formula");
    expect(rejected.decision.status).toBe("corrected");
  });

  it("does not accept a category from the entity name alone", () => {
    const [entity] = applyPlannedEntityTypes(plan("zh"), [{
      name: "示例响应定律", type: "概念", summary: "尚无足够上下文。",
    }]);
    expect(entity.type).toBe("定律");
    expect(entity.classification.status).toBe("needs_review");
    expect(entity.classification.source).toBe("lexical");
  });

  it("allows independently reviewed semantic context to override a misleading name", () => {
    const generated = plan("zh");
    applyPlannedEntityTypes(generated, [{ name: "示例响应定律", type: "概念" }]);
    const resolved = resolveEntityClassification(generated, {
      name: "客户增长定律",
      summary: "公司内部用于计算客户同比增长率的表达式，并非被报告为经验定律。",
      properties: { 计算公式: "(current - previous) / previous" },
    }, {
      categoryId: "formula", semanticRole: "formula", confidence: .93,
      explicitIdentity: false, identityEvidenceVerified: false,
      semanticExplanation: "这是一个计算指标变化率的表达式。",
      decisionFactors: ["属性提供明确计算公式", "原文未将其作为定律报告"],
      reason: "定义、用途和属性均符合公式类别。", source: "review",
    });
    expect(resolved.category.role).toBe("formula");
    expect(resolved.decision.status).toBe("accepted");
    expect(resolved.decision.semanticExplanation).toContain("表达式");
  });

  it("applies the same semantic guard outside course Wikis", () => {
    const businessPlan = normalizeGenerationPlan({
      ...plan("zh"), detectedPreset: "business", researchGoal: "分析客户经营指标",
    }, {
      ...academicProfile, preset: "business", researchGoal: "分析客户经营指标",
      entityTypes: ["概念", "指标", "公式", "定律"],
    });
    const [entity] = applyPlannedEntityTypes(businessPlan, [{
      name: "客户流失率与价格变化关系", type: "定律",
      summary: "描述价格变化与客户流失率之间的统计关系。",
      properties: { 计算公式: "churn = lost / total" },
    }]);
    expect(entity.type).toBe("公式");
    expect(entity.classification.semanticRole).toBe("formula");
  });

  it("keeps user-requested types and rejects corpus entities as top-level categories", () => {
    const generated = normalizeGenerationPlan({
      ...plan("zh"),
      categories: [
        { id: "centripetal-acceleration", label: "向心加速度", role: "quantity", definition: "主题", inclusionExamples: [], exclusionExamples: [] },
        { id: "law", label: "定律", role: "law", definition: "通用类别", inclusionExamples: [], exclusionExamples: [] },
        { id: "wave", label: "波", role: "concept", definition: "主题", inclusionExamples: [], exclusionExamples: [] },
        { id: "wave-equation", label: "波动方程", role: "formula", definition: "实体", inclusionExamples: [], exclusionExamples: [] },
        { id: "dimensional-analysis", label: "量纲分析", role: "method", definition: "实体", inclusionExamples: [], exclusionExamples: [] },
      ],
      relationTypes: [], requiredKnowledge: [],
    }, academicProfile);
    expect(generated.categories.map(category => category.label)).toEqual([
      "概念", "方法", "理论", "实验", "指标", "公式", "定律",
    ]);
    expect(generated.relationTypes).toEqual(academicProfile.preferredRelations);
    expect(generated.requiredKnowledge).toEqual(academicProfile.importantFields);
  });

  it("classifies specific topics as entities under broad user categories", () => {
    const generated = fallbackGenerationPlan(academicProfile, []);
    const entities = applyPlannedEntityTypes(generated, [
      { name: "向心加速度", type: "向心加速度" },
      { name: "波", type: "波" },
      { name: "波动方程", type: "波动方程" },
      { name: "量纲分析", type: "量纲分析" },
    ]);
    expect(entities.map(entity => entity.type)).toEqual(["指标", "概念", "公式", "方法"]);
  });

  it("builds a fallback ontology directly from the user's requested knowledge types", () => {
    const generated = fallbackGenerationPlan(academicProfile, []);
    expect(generated.categories.map(category => category.label)).toEqual([
      "概念", "方法", "理论", "实验", "指标", "公式",
    ]);
  });

  it("applies the same semantic correction to English law names", () => {
    const [entity] = applyPlannedEntityTypes(plan("en"), [
      { name: "Newton's Second Law", type: "Formula" },
    ]);
    expect(entity.type).toBe("Law");
  });

  it("maps free-form provider types back to a category in the approved plan", () => {
    const [entity] = applyPlannedEntityTypes(plan("zh"), [
      { name: "惯性参考系", type: "AI 自创类别" },
    ]);
    expect(entity.type).toBe("概念");
  });

  it("samples every document and includes distributed late content", () => {
    const blocks: DocumentBlock[] = [
      ...Array.from({ length: 12 }, (_, index) => ({
        id: `a-${index}`, documentId: "doc-a", page: index + 1, blockType: "paragraph" as const,
        text: `A ${index}`, sourceLocation: `page ${index + 1}`,
      })),
      { id: "b-0", documentId: "doc-b", page: 1, blockType: "paragraph", text: "B", sourceLocation: "page 1" },
    ];
    const samples = representativeCorpusSample(blocks, 4);
    expect(samples.map(sample => sample.documentId)).toEqual(["doc-a", "doc-b"]);
    expect(samples[0].blocks.some(block => block.blockId === "a-11")).toBe(true);
  });
});

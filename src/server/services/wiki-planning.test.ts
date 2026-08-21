import { describe, expect, it } from "vitest";
import { normalizeEntityTypes, WikiProfileSchema, type DocumentBlock, type WikiGenerationPlan, type WikiProfile } from "../../shared/contracts.js";
import {
  applyPlannedEntityTypes,
  fallbackGenerationPlan,
  normalizeGenerationPlan,
  representativeCorpusSample,
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
      definition: language === "zh" ? "可独立复用的计算或关系表达式" : "A reusable computational or relational expression",
      inclusionExamples: [], exclusionExamples: [],
    },
    {
      id: "concept", label: language === "zh" ? "概念" : "Concept", role: "concept",
      definition: language === "zh" ? "具有独立定义的核心知识对象" : "A core knowledge object with an independent definition",
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

  it("normalizes extracted labels without creating a classification review decision", () => {
    const generated = plan("zh");
    const entities = applyPlannedEntityTypes(generated, [
      { name: "牛顿第一定律", type: "概念" },
      { name: "Newton's Second Law", type: "公式" },
    ]);

    expect(entities.map(entity => entity.type)).toEqual(["概念", "公式"]);
    expect(entities.every(entity => !("classification" in entity))).toBe(true);
    expect(generated.categories.map(category => category.label)).toEqual(["公式", "概念"]);
  });

  it("uses only the supplied type label and does not infer from equation-like properties", () => {
    const [entity] = applyPlannedEntityTypes(plan("zh"), [{
      name: "输入输出关系",
      type: "概念",
      summary: "描述两个量之间的关系。",
      properties: { 表达式: "y = kx" },
    }]);

    expect(entity.type).toBe("概念");
    expect("classification" in entity).toBe(false);
  });

  it("keeps comma-separated user types exact while preserving AI-planned category meanings", () => {
    expect(normalizeEntityTypes([" 样品, 材料 ", "工艺，样品", "", "材料"])).toEqual(["样品", "材料", "工艺"]);
    expect(WikiProfileSchema.parse({ ...academicProfile, entityTypes: ["样品, 材料", "工艺"] }).entityTypes)
      .toEqual(["样品", "材料", "工艺"]);

    const strict = normalizeGenerationPlan({
      ...plan("zh"),
      categories: [
        { id: "sample", label: "样品", role: "material", definition: "在当前研究中按批次、处理条件或来源区分的受检对象。", inclusionExamples: ["样品批次"], exclusionExamples: ["材料的一般定义"] },
        { id: "material", label: "材料", role: "material", definition: "具有可复用组成或结构身份的研究对象。", inclusionExamples: ["主体材料"], exclusionExamples: ["单个测试批次"] },
        { id: "process", label: "工艺", role: "method", definition: "改变研究对象状态或性质的可重复步骤序列。", inclusionExamples: ["处理步骤"], exclusionExamples: ["结果指标"] },
        { id: "forbidden", label: "额外类别", role: "other", definition: "不应保留", inclusionExamples: [], exclusionExamples: [] },
      ],
    }, {
      ...academicProfile,
      entityTypes: [" 样品, 材料 ", "工艺，样品"],
    });

    expect(strict.entityTypePolicy).toBe("strict");
    expect(strict.categories.map(category => category.label)).toEqual(["样品", "材料", "工艺"]);
    expect(strict.categories.map(category => category.definition)).toEqual([
      "在当前研究中按批次、处理条件或来源区分的受检对象。",
      "具有可复用组成或结构身份的研究对象。",
      "改变研究对象状态或性质的可重复步骤序列。",
    ]);
    expect(strict.categories[0].inclusionExamples).toEqual(["样品批次"]);
  });

  it("never adds categories during extraction, even in an open plan", () => {
    const generated = normalizeGenerationPlan({
      ...plan("zh"),
      categories: [
        { id: "claim", label: "主张", role: "other", definition: "有证据支持、可被检验的陈述。", inclusionExamples: [], exclusionExamples: [] },
        { id: "constraint", label: "约束", role: "other", definition: "限定主张适用范围的条件。", inclusionExamples: [], exclusionExamples: [] },
      ],
    });
    const before = generated.categories.map(category => category.id);
    applyPlannedEntityTypes(generated, [{ name: "任何名称", type: "未计划类别" }]);

    expect(generated.categories.map(category => category.id)).toEqual(before);
    expect(generated.categories.map(category => category.definition)).toEqual([
      "有证据支持、可被检验的陈述。",
      "限定主张适用范围的条件。",
    ]);
  });

  it("keeps arbitrary user labels as the exact controlled type", () => {
    const strict = fallbackGenerationPlan({
      ...academicProfile,
      entityTypes: ["风险信号", "治理动作", "适用边界"],
    }, []);
    const [entity] = applyPlannedEntityTypes(strict, [{
      name: "某个熟悉的物理名称", type: "风险信号",
    }]);

    expect(strict.categories.map(category => category.label)).toEqual(["风险信号", "治理动作", "适用边界"]);
    expect(entity.type).toBe("风险信号");
    expect("classification" in entity).toBe(false);
  });

  it("falls back to the first controlled category when an extractor emits an unknown label", () => {
    const [entity] = applyPlannedEntityTypes(plan("zh"), [
      { name: "惯性参考系", type: "AI 自创类别" },
    ]);
    expect(entity.type).toBe("公式");
    expect("classification" in entity).toBe(false);
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

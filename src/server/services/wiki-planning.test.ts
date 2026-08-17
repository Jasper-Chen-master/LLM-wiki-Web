import { describe, expect, it } from "vitest";
import type { DocumentBlock, WikiGenerationPlan, WikiProfile } from "../../shared/contracts.js";
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
  it("adds a controlled law category when the AI plan omits it", () => {
    expect(plan("zh").categories).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "law", label: "定律" }),
    ]));
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
      "概念", "方法", "理论", "实验", "指标", "公式", "定律",
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

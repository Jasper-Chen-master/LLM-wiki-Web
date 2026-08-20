import { describe, expect, it } from "vitest";
import type { WikiGenerationPlan, WikiProfile } from "../../shared/contracts.js";
import {
  classificationPrompt,
  corpusAnalysisPrompt,
  extractionPrompt,
  generationPlanPrompt,
  relevancePrompt,
} from "./wiki-generation.js";

const profile: WikiProfile = {
  version: "1.0",
  researchGoal: "理解材料制备、结构与性能之间的关系",
  domain: "材料科学",
  entityTypes: ["材料", "方法", "指标"],
  importantFields: ["制备条件", "性能", "局限性"],
  preferredRelations: ["影响"],
  exclude: [],
  extractNumericData: true,
  preserveUnits: true,
  extractTables: true,
  evidenceRequired: true,
  notes: "",
  outputLanguage: "zh",
  targetQuestions: ["哪些制备条件影响循环性能？"],
  unitOfAnalysis: "可复用知识主题",
};

const plan: WikiGenerationPlan = {
  version: "2.0",
  outputLanguage: "zh",
  researchGoal: profile.researchGoal,
  corpusSummary: "论文比较了不同制备条件下材料结构与循环性能。",
  themes: ["制备", "结构", "循环性能"],
  requiredKnowledge: ["制备条件", "结构变化", "性能结果", "限制与例外"],
  categories: [
    { id: "material", label: "材料", role: "material", definition: "被研究的物质或样品", inclusionExamples: [], exclusionExamples: [] },
    { id: "method", label: "方法", role: "method", definition: "制备或分析方法", inclusionExamples: [], exclusionExamples: [] },
    { id: "quantity", label: "指标", role: "quantity", definition: "可测量的性能指标", inclusionExamples: [], exclusionExamples: [] },
  ],
  relationTypes: ["影响"],
  classificationRules: ["按定义与功能分类，不按名称后缀分类。"],
  detectedPreset: "research",
  unitOfAnalysis: "可复用知识主题",
  targetQuestions: profile.targetQuestions ?? [],
  fieldRules: [],
  relationRules: [],
  analyzedDocumentIds: ["paper-a", "paper-b"],
  createdAt: "2026-08-20T00:00:00.000Z",
};

describe("Wiki generation prompts", () => {
  it("requires corpus-level understanding and a document-wide coverage audit before planning", () => {
    const prompt = corpusAnalysisPrompt(profile, [
      { documentId: "paper-a", blocks: [{ blockId: "a-1", page: 1, section: "引言", blockType: "paragraph", text: "研究背景" }] },
      { documentId: "paper-b", blocks: [{ blockId: "b-9", page: 9, section: "局限性", blockType: "paragraph", text: "少数条件下性能下降" }] },
    ]);

    expect(prompt).toContain("GLOBAL UNDERSTANDING");
    expect(prompt).toContain("read every supplied document sample and block");
    expect(prompt).toContain("COVERAGE AUDIT");
    expect(prompt).toContain("minority source");
    expect(prompt).toContain("negative result");
    expect(prompt).toContain("paper-b");
  });

  it("treats required knowledge as a coverage contract without turning topics into categories", () => {
    const prompt = generationPlanPrompt(profile, [{ corpusSummary: plan.corpusSummary, requiredKnowledge: plan.requiredKnowledge }]);

    expect(prompt).toContain("requiredKnowledge as a coverage contract");
    expect(prompt).toContain("Categories must be exhaustive enough");
    expect(prompt).toContain("Prefer a broad stable category plus precise entity properties");
    expect(prompt).toContain("rather than name suffixes alone");
  });

  it("instructs every generation stage to preserve a non-empty comma-separated type list exactly", () => {
    const strictProfile = { ...profile, entityTypes: ["样品, 材料, 工艺"] };
    const planning = generationPlanPrompt(strictProfile, [{ corpusSummary: plan.corpusSummary }]);
    const extraction = extractionPrompt(strictProfile, plan, [{ blockId: "b-1", text: "样品采用某工艺制备。" }]);
    const classification = classificationPrompt(strictProfile, plan, [{ name: "样品A", summary: "一个样品。" }]);

    for (const prompt of [planning, extraction, classification]) {
      expect(prompt).toContain("STRICT USER TYPE CONTRACT");
      expect(prompt).toContain('["样品","材料","工艺"]');
      expect(prompt).toContain("Do not add, remove, rename, merge, split, translate, or infer any other type");
    }
    expect(planning).toContain("must never create or remove a category");
    expect(extraction).toContain("type field must be copied exactly");
    expect(classification).toContain("no other category may be proposed");
  });

  it("builds consolidated, canonical, information-rich nodes and audits every input block", () => {
    const prompt = extractionPrompt(profile, plan, [
      { blockId: "a-3", documentId: "paper-a", page: 3, section: "制备", blockType: "paragraph", text: "LFP 使用固相法制备。" },
      { blockId: "b-7", documentId: "paper-b", page: 7, section: "结果", blockType: "table", text: "LiFePO4 在 1 C 下容量为 140 mAh/g。" },
    ]);

    expect(prompt).toContain("UNDERSTAND THE WHOLE");
    expect(prompt).toContain("read every supplied block");
    expect(prompt).toContain("CONSOLIDATE AND EXTRACT");
    expect(prompt).toContain("merge repeated mentions");
    expect(prompt).toContain("A paragraph, sentence, heading, isolated claim");
    expect(prompt).toContain("concise, normalized, domain-standard identity");
    expect(prompt).toContain("fewer well-formed, information-rich nodes");
    expect(prompt).toContain("requiredKnowledge");
    expect(prompt).toContain('"documentId":"paper-b"');
    expect(prompt).toContain('"section":"结果"');
  });

  it("preserves coverage context during relevance filtering", () => {
    const prompt = relevancePrompt(profile, plan, [
      { blockId: "late", documentId: "paper-a", page: 12, section: "讨论", blockType: "paragraph", text: "该趋势在低温下不成立。" },
    ]);

    expect(prompt).toContain("complete supplied batch");
    expect(prompt).toContain("limitations, exceptions, negative results");
    expect(prompt).toContain("coverage gap");
    expect(prompt).toContain('"page":12');
  });

  it("classifies from full semantic context by comparing every controlled category", () => {
    const prompt = classificationPrompt(profile, plan, [{
      name: "固相反应法",
      proposedType: "材料",
      summary: "用于合成磷酸铁锂的制备流程。",
      evidenceContext: [{ documentId: "paper-a", page: 3, section: "实验方法", text: "样品采用固相反应法制备。" }],
      relationContext: [{ source: "固相反应法", relationType: "制备", target: "磷酸铁锂" }],
    }]);

    expect(prompt).toContain("read every entity in the supplied batch");
    expect(prompt).toContain("test the entity against every controlled category");
    expect(prompt).toContain("semantic identity and function");
    expect(prompt).toContain("CONSISTENCY AUDIT");
    expect(prompt).toContain("classificationRules");
  });
});

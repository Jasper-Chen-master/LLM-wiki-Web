import { describe, expect, it } from "vitest";
import type { WikiGenerationPlan, WikiProfile } from "../../shared/contracts.js";
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
  it("uses Chinese instructions in every Wiki generation stage", () => {
    const systems = [
      corpusAnalysisSystemPrompt(profile),
      generationPlanSystemPrompt(profile),
      relevanceSystemPrompt(profile),
      extractionSystemPrompt(profile),
      semanticInterpretationSystemPrompt(profile),
      classificationSystemPrompt(profile),
    ];

    for (const prompt of systems) {
      expect(prompt).toContain("你负责");
      expect(prompt).toContain("只返回 JSON");
      for (const englishInstruction of ["You ", "Return ", "Read ", "Work ", "Document text"]) {
        expect(prompt).not.toContain(englishInstruction);
      }
    }
  });

  it("requires corpus-level understanding and a document-wide coverage audit before planning", () => {
    const prompt = corpusAnalysisPrompt(profile, [
      { documentId: "paper-a", blocks: [{ blockId: "a-1", page: 1, section: "引言", blockType: "paragraph", text: "研究背景" }] },
      { documentId: "paper-b", blocks: [{ blockId: "b-9", page: 9, section: "局限性", blockType: "paragraph", text: "少数条件下性能下降" }] },
    ]);

    expect(prompt).toContain("全局理解");
    expect(prompt).toContain("全部文档样本与文档块");
    expect(prompt).toContain("结构提炼");
    expect(prompt).toContain("跨领域理解原则");
    expect(prompt).toContain("覆盖复核");
    expect(prompt).toContain("少数文档");
    expect(prompt).toContain("负结果");
    expect(prompt).toContain("paper-b");
  });

  it("treats required knowledge as a coverage contract without turning topics into categories", () => {
    const prompt = generationPlanPrompt(profile, [{ corpusSummary: plan.corpusSummary, requiredKnowledge: plan.requiredKnowledge }]);

    expect(prompt).toContain("requiredKnowledge 是覆盖契约");
    expect(prompt).toContain("最小、稳定、互不混淆");
    expect(prompt).toContain("宽而清晰的类别 + 精确字段和关系");
    expect(prompt).toContain("名称后缀、格式或章节位置");
    expect(prompt).toContain("不得要求所有领域或节点拥有每一维度");
    expect(prompt).toContain("不要把主题、文档结构或单个实体升级为类别");
  });

  it("preserves every non-empty comma-separated user type exactly and forbids strict-mode category additions", () => {
    const strictProfile = { ...profile, entityTypes: ["样品, 材料, 工艺"] };
    const corpus = corpusAnalysisPrompt(strictProfile, []);
    const planning = generationPlanPrompt(strictProfile, [{ corpusSummary: plan.corpusSummary }]);
    const extraction = extractionPrompt(strictProfile, plan, [{ blockId: "b-1", text: "样品采用某工艺制备。" }]);
    const classification = classificationPrompt(strictProfile, plan, [{ name: "样品A", summary: "一个样品。" }]);

    for (const prompt of [corpus, planning, extraction, classification]) {
      expect(prompt).toContain("严格用户类型契约");
      expect(prompt).toContain('["样品","材料","工艺"]');
      expect(prompt).toContain("不得新增、删除、改名、合并、拆分、翻译或推断任何其他类型");
    }
    expect(corpus).toContain("必须返回空数组 []");
    expect(planning).toContain("绝不能新增或删除");
    expect(extraction).toContain("type 必须逐字复制用户标签之一");
    expect(classification).toContain("不能提议任何其他类别");
  });

  it("builds consolidated, canonical, self-contained mini Wiki nodes and audits every input block", () => {
    const prompt = extractionPrompt(profile, plan, [
      { blockId: "a-3", documentId: "paper-a", page: 3, section: "制备", blockType: "paragraph", text: "LFP 使用固相法制备。" },
      { blockId: "b-7", documentId: "paper-b", page: 7, section: "结果", blockType: "table", text: "LiFePO4 在 1 C 下容量为 140 mAh/g。" },
    ]);

    expect(prompt).toContain("理解整体");
    expect(prompt).toContain("完整阅读本批全部文档块");
    expect(prompt).toContain("盘点并合并");
    expect(prompt).toContain("输出前覆盖检查");
    expect(prompt).toContain("合并同一真实或概念身份");
    expect(prompt).toContain("简洁、规范、适合跨文档复用");
    expect(prompt).toContain("较少但完整、连贯、信息密度高的节点");
    expect(prompt).toContain("迷你 Wiki 完整性");
    expect(prompt).toContain("适用条件与边界");
    expect(prompt).toContain("不得因名称、章节格式或领域惯例补造");
    expect(prompt).toContain("requiredKnowledge");
    expect(prompt).toContain('"documentId":"paper-b"');
    expect(prompt).toContain('"section":"结果"');
  });

  it("preserves coverage context during relevance filtering", () => {
    const prompt = relevancePrompt(profile, plan, [
      { blockId: "late", documentId: "paper-a", page: 12, section: "讨论", blockType: "paragraph", text: "该趋势在低温下不成立。" },
    ]);

    expect(prompt).toContain("完整阅读本批全部文档块");
    expect(prompt).toContain("对比、限制、例外、负结果、反例或分歧");
    expect(prompt).toContain("身份、逻辑、范围、证据或边界");
    expect(prompt).toContain("覆盖缺口");
    expect(prompt).toContain('"page":12');
  });

  it("classifies from complete node context in one controlled pass, including when an interpretation is absent", () => {
    const prompt = classificationPrompt(profile, plan, [{
      name: "固相反应法",
      summary: "用于合成磷酸铁锂的制备流程。",
      evidenceContext: [{ documentId: "paper-a", page: 3, section: "实验方法", text: "样品采用固相反应法制备。" }],
      relationContext: [{ source: "固相反应法", relationType: "制备", target: "磷酸铁锂" }],
    }]);

    expect(prompt).toContain("完整阅读本批全部节点后再分类");
    expect(prompt).toContain("中心主体、功能、边界和有证据支持的角色");
    expect(prompt).toContain("逐一对照所有类别");
    expect(prompt).toContain("不能代替完整的来源语义");
    expect(prompt).toContain("semanticInterpretation 缺失");
    expect(prompt).toContain("不得漏掉实体、创建类别，或返回复核/暂定状态字段");
    expect(prompt).toContain("classificationRules");
  });

  it("keeps evidence-grounded semantic understanding before classification", () => {
    const prompt = semanticInterpretationPrompt(profile, plan, [{
      name: "固相反应法",
      summary: "用于合成磷酸铁锂的制备流程。",
      evidenceContext: [{ documentId: "paper-a", page: 3, section: "实验方法", text: "样品采用固相反应法制备。" }],
      relationContext: [{ source: "固相反应法", relationType: "制备", target: "磷酸铁锂" }],
    }]);

    expect(prompt).toContain("只理解含义，为后续受控分类提供基础");
    expect(prompt).toContain("中心主体与边界");
    expect(prompt).toContain("identityEvidence 必须逐字摘自 evidenceContext");
    expect(prompt).toContain("不得输出 category、role、type 或任何本体标签");
  });
});

import type { Project, WikiProfile } from "../../../shared/contracts";

export type ProfileListDraft = { entityTypes: string; preferredRelations: string; exclude: string };
export type ProfileListInputs = ProfileListDraft;

export const overviewDrafts = new Map<
  string,
  { selectedTemplate: string; profile: WikiProfile; listInputs?: ProfileListInputs; profileDirty?: boolean }
>();

export const emptyProfile: WikiProfile = {
  version: "1.0",
  researchGoal: "",
  domain: "General research",
  entityTypes: [],
  importantFields: [],
  preferredRelations: [],
  exclude: [],
  extractNumericData: true,
  preserveUnits: true,
  extractTables: false,
  evidenceRequired: true,
  notes: "",
  preset: "auto",
  customRequirements: "",
};
export const PRESET_TEMPLATES: Record<
  "general" | "research" | "course" | "experimental" | "business",
  { en: WikiProfile; zh: WikiProfile }
> = {
  research: {
    en: {
    version: "1.0",
    researchGoal:
      "Extract the core concepts, methods, evidence, and findings from academic papers or lecture notes, and connect them into a traceable knowledge structure.",
    domain: "Academic research",
    entityTypes: [
      "concept",
      "method",
      "theory",
      "experiment",
      "metric",
      "formula",
    ],
    importantFields: [
      "definition",
      "formula",
      "method",
      "conclusion",
      "evidence",
    ],
    preferredRelations: ["derives", "proves", "applies", "compares", "causes"],
    exclude: [],
    extractNumericData: true,
    preserveUnits: true,
    extractTables: false,
    evidenceRequired: true,
    notes: "",
    },
    zh: {
      version: "1.0",
      researchGoal: "从学术论文或课件中提取核心概念、方法、证据与结论，并将其连接为可追溯的知识结构。",
      domain: "学术研究",
      entityTypes: ["概念", "方法", "理论", "实验", "指标", "公式"],
      importantFields: ["定义", "公式", "方法", "结论", "证据"],
      preferredRelations: ["推导", "证明", "应用", "对比", "导致"],
      exclude: [],
      extractNumericData: true,
      preserveUnits: true,
      extractTables: false,
      evidenceRequired: true,
      notes: "",
    },
  },
  general: {
    en: {
    version: "1.0",
    researchGoal:
      "Detect the document purpose and build the smallest sufficient evidence-grounded Wiki for understanding, retrieval, comparison, analysis, or decision support.",
    domain: "Auto-detected",
    entityTypes: [],
    importantFields: ["definition", "evidence"],
    preferredRelations: [],
    exclude: [],
    extractNumericData: true,
    preserveUnits: true,
    extractTables: false,
    evidenceRequired: true,
    notes: "",
    },
    zh: {
      version: "1.0",
      researchGoal: "自动识别文档用途，生成满足理解、检索、比较、分析或决策需求的最小充分、证据可追溯 Wiki。",
      domain: "自动识别",
      entityTypes: [],
      importantFields: ["定义", "证据"],
      preferredRelations: [],
      exclude: [],
      extractNumericData: true,
      preserveUnits: true,
      extractTables: false,
      evidenceRequired: true,
      notes: "",
    },
  },
  business: {
    en: {
    version: "1.0",
    researchGoal:
      "Extract market, competitive, strategic, and financial information from business documents, and map the relationships between players, products, and metrics.",
    domain: "Business analysis",
    entityTypes: [
      "company",
      "product",
      "market",
      "strategy",
      "metric",
      "trend",
    ],
    importantFields: ["market share", "revenue", "strategy", "competition"],
    preferredRelations: [
      "competes with",
      "invests in",
      "partners with",
      "affects",
      "grows",
    ],
    exclude: [],
    extractNumericData: true,
    preserveUnits: true,
    extractTables: true,
    evidenceRequired: true,
    notes: "",
    },
    zh: {
      version: "1.0",
      researchGoal: "从商业文档中提取市场、竞争、战略与财务信息，梳理参与者、产品与指标之间的关系。",
      domain: "商业分析",
      entityTypes: ["公司", "产品", "市场", "战略", "指标", "趋势"],
      importantFields: ["市场份额", "营收", "战略", "竞争"],
      preferredRelations: ["竞争", "投资", "合作", "影响", "增长"],
      exclude: [],
      extractNumericData: true,
      preserveUnits: true,
      extractTables: true,
      evidenceRequired: true,
      notes: "",
    },
  },
  course: {
    en: { version: "1.0", researchGoal: "Build a learning Wiki that preserves concepts, definitions, laws, formulas, derivations, examples, and prerequisite structure across the course.", domain: "Course learning", entityTypes: ["concept", "law", "formula", "method", "example", "quantity"], importantFields: ["definition", "formula", "derivation", "conditions", "example"], preferredRelations: ["defines", "derives", "requires", "applies to", "exemplifies"], exclude: ["administrative course information"], extractNumericData: true, preserveUnits: true, extractTables: false, evidenceRequired: true, notes: "" },
    zh: { version: "1.0", researchGoal: "构建保留课程概念、定义、定律、公式、推导、例题与先修结构的学习 Wiki。", domain: "课程学习", entityTypes: ["概念", "定律", "公式", "方法", "例子", "物理量"], importantFields: ["定义", "公式", "推导", "适用条件", "例子"], preferredRelations: ["定义", "推导", "依赖", "应用于", "举例"], exclude: ["课程行政信息"], extractNumericData: true, preserveUnits: true, extractTables: false, evidenceRequired: true, notes: "" },
  },
  experimental: {
    en: { version: "1.0", researchGoal: "Extract experiments as condition-bound records and connect samples, procedures, measurements, observations, mechanisms, and outcomes without merging incompatible conditions.", domain: "Experimental research", entityTypes: ["sample", "material", "process", "experiment", "measurement", "mechanism", "outcome"], importantFields: ["sample identity", "conditions", "procedure", "value", "unit", "uncertainty", "evidence"], preferredRelations: ["prepared by", "tested under", "measured by", "produces", "affects"], exclude: [], extractNumericData: true, preserveUnits: true, extractTables: true, evidenceRequired: true, notes: "" },
    zh: { version: "1.0", researchGoal: "以实验条件为边界提取记录，连接样品、工艺、测量、观察、机制与结果，禁止合并不兼容条件。", domain: "实验研究", entityTypes: ["样品", "材料", "工艺", "实验", "测量", "机制", "结果"], importantFields: ["样品标识", "实验条件", "步骤", "数值", "单位", "不确定度", "证据"], preferredRelations: ["制备于", "测试条件", "测量方法", "产生", "影响"], exclude: [], extractNumericData: true, preserveUnits: true, extractTables: true, evidenceRequired: true, notes: "" },
  },
};
export type PresetTemplateId = keyof typeof PRESET_TEMPLATES;
export const TEMPLATE_PRESETS: Record<PresetTemplateId, NonNullable<WikiProfile["preset"]>> = {
  general: "auto", research: "research", course: "course",
  experimental: "experimental", business: "business",
};
export const templateForProfile = (profile: WikiProfile | undefined): PresetTemplateId | "custom" => {
  if (!profile?.preset || profile.preset === "custom") return "custom";
  if (profile.preset === "auto") return "general";
  return (Object.entries(TEMPLATE_PRESETS).find(([, preset]) => preset === profile.preset)?.[0] as PresetTemplateId | undefined) ?? "custom";
};
export const split = (input: string) =>
  input
    .split(/[,，]/u)
    .map((value) => value.trim())
    .filter(Boolean);
export const join = (input: string[]) => input.join(", ");
export const listInputsFromProfile = (profile: WikiProfile): ProfileListInputs => ({
  entityTypes: join(profile.entityTypes),
  preferredRelations: join(profile.preferredRelations),
  exclude: join(profile.exclude),
});
export const PROFILE_SYNC_CHANNEL = "llm-wiki-profile-sync";
export const PROFILE_SYNC_STORAGE_KEY = "llm-wiki-profile-sync-message";
export type ProfileSyncMessage = { id: string; projectId: string; profile: WikiProfile };
export const isProfileSyncMessage = (value: unknown): value is ProfileSyncMessage => {
  if (!value || typeof value !== "object") return false;
  const message = value as Partial<ProfileSyncMessage>;
  return typeof message.id === "string" && typeof message.projectId === "string" && Boolean(message.profile);
};
export const profileSyncPublisher = typeof BroadcastChannel !== "undefined"
  ? new BroadcastChannel(PROFILE_SYNC_CHANNEL)
  : undefined;
export const publishProfileSync = (projectId: string, profile: WikiProfile) => {
  const message: ProfileSyncMessage = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    projectId,
    profile,
  };
  if (profileSyncPublisher) {
    profileSyncPublisher.postMessage(message);
    return;
  }
  try {
    localStorage.setItem(PROFILE_SYNC_STORAGE_KEY, JSON.stringify(message));
  } catch {
    // Server persistence remains the source of truth if browser storage is unavailable.
  }
};


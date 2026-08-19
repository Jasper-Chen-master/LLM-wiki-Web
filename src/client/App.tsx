import {
  createContext,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Link,
  Navigate,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import katex from "katex";
import "katex/contrib/mhchem/mhchem.js";
import "katex/dist/katex.min.css";
import type {
  ChatClaim,
  ChatCitation,
  ChatMessage,
  ChatThread,
  Project,
  ProjectSnapshot,
  WikiNode,
  WikiProfile,
} from "../shared/contracts";
import { api } from "./api";

type Language = "en" | "zh";
const overviewDrafts = new Map<
  string,
  { selectedTemplate: string; profile: WikiProfile }
>();
const copy = {
  en: {
    delete: "Remove selected",
    selected: "selected",
    reprocess: "Rebuild this Wiki",
    deleteHelp: "Select sources to remove them from this research space.",
    brand: "Evidence Atlas",
    eyebrow: "EVIDENCE-FIRST AI RESEARCH",
    hero: "Build a research Wiki you can trace back to evidence.",
    lede: "Define what you need to know. Evidence Atlas turns your sources into structured concepts, relationships, explanations, and page-level citations.",
    start: "Create a knowledge project",
    example: "Example: Why battery cathodes degrade",
    create: "Create workspace",
    projects: "Research spaces",
    total: "total",
    loading: "Loading research spaces…",
    empty:
      "No research spaces yet. Create one to turn your sources into an evidence-linked Wiki.",
    active: "Wiki ready for exploration and questions",
    review: "Research blueprint awaiting confirmation",
    setup: "Research blueprint not defined",
    created: "Created",
    lastEdited: "Last edited",
    opening: "Opening project…",
    overview: "Build",
    graph: "Knowledge graph",
    search: "Wiki search",
    chat: "Wiki assistant",
    chatSub: "AI interprets your question, reasons over this Wiki, and cites the supporting source pages.",
    newChat: "New inquiry",
    deleteChat: "Delete inquiry",
    deleteChatConfirm: "Delete this inquiry and all of its messages? This cannot be undone.",
    askWiki: "Ask about concepts, mechanisms, comparisons, or implications…",
    send: "Ask",
    chatReady: "Answering from the current evidence-linked Wiki.",
    chatUnavailable: "Build the Wiki before asking evidence-grounded questions.",
    citations: "Evidence sources",
    limitations: "Knowledge boundaries",
    noChats: "Start an inquiry grounded in this project's Wiki.",
    workspace: "Wiki builder",
    workspaceSub:
      "Set the knowledge boundary, add evidence sources, then build a Wiki for exploration, search, and analysis.",
    exportJson: "Export structured Wiki",
    exportCsv: "Export node table",
    guide: "Define the Wiki's knowledge boundary",
    confirmed: "Blueprint active",
    ready: "Awaiting confirmation",
    required: "Blueprint required",
    help: "Tell the system what matters to your research. Only relevant, evidence-backed knowledge should enter the main Wiki.",
    objective: "Guiding research question",
    objectiveHint: "What should this Wiki help you understand, compare, or predict?",
    domain: "Research domain",
    entityTypes: "Knowledge types to retain",
    entitiesHint: "material, mechanism, method, metric",
    relations: "Relationships to prioritize",
    relationsHint: "causes, improves, measured by, derived from",
    ignore: "Knowledge to leave out",
    ignoreHint: "generic background, unrelated methods",
    customRequirements: "Custom generation requirements",
    customRequirementsHint: "Describe any custom ontology, fields, relation logic, priorities, or output constraints.",
    classificationDecision: "Classification decision",
    semanticMembers: "Consolidated semantic members",
    save: "Save blueprint",
    confirm: "Confirm and build Wiki",
    rerun: "Rebuild from current sources",
    working: "Building…",
    upload: "Add research materials",
    profile: "Research blueprint",
    profileDetail: "DOCX · research goals and knowledge priorities",
    sources: "Evidence sources",
    sourceDetail: "PDF or DOCX · source material for this Wiki",
    choose: "Add file",
    chooseMany: "Add files",
    noFiles: "No evidence sources added yet.",
    source: "Evidence source",
    processing: "Wiki build",
    processingHelp:
      "Confirm the blueprint to parse sources, filter for relevance, extract candidates, consolidate semantic overlap with AI, and bind every result to evidence.",
    graphSub: "Explore how evidence-backed concepts, methods, findings, and relationships connect.",
    searchKnowledge: "Search this Wiki",
    find: "Focus a Wiki node…",
    allTypes: "All types",
    nodes: "nodes",
    relationsCount: "relations",
    graphEmpty:
      "Your knowledge graph will appear after the research blueprint is confirmed and the evidence sources are processed.",
    clickNode: "Select a node to inspect its meaning, relationships, and evidence",
    noProperties: "No structured details available.",
    related: "Connected knowledge",
    selectNode: "Select a node to open its Wiki detail.",
    searchSub:
      "Retrieve concepts, aliases, summaries, properties, and relationships from the current structured Wiki.",
    searchHint: "Search a concept, method, finding, formula, or property…",
    matching: "Wiki results",
    noSummary: "This node has no readable summary yet.",
    alsoKnown: "Also known as",
    confidence: "confidence",
    noResults:
      "This Wiki does not contain matching knowledge yet. Try a broader concept or add more evidence sources.",
    importance: "Research relevance",
    language: "Switch language",
    profileRole: "Research blueprint",
    evidenceLabel: "Evidence",
    evidenceFirst: "Evidence-linked research",
    localWorkspace: "Private local workspace",
    wikiVersion: "Wiki revision",
    page: "page",
    observed: "Observed",
    reported: "Source reported",
    inferred: "Wiki synthesis",
    inferenceNotice: "AI inference · evidence-based synthesis",
    chatCreateError: "Could not start a new inquiry.",
    chatSendError: "Could not complete this Wiki inquiry.",
    chatDeleteError: "Could not delete this inquiry.",
    jobQueued: "Queued",
    jobParsing: "Reading sources",
    jobAnalyzing: "Analyzing goal and corpus",
    jobPlanning: "Planning Wiki categories",
    jobFiltering: "Applying research focus",
    jobExtracting: "Building evidence claims",
    jobResolving: "Merging duplicate concepts",
    jobBuildingGraph: "Linking the knowledge graph",
    jobCompleted: "Wiki ready",
    jobFailed: "Build interrupted",
    jobQueuedMessage: "The evidence sources are waiting to enter the Wiki build.",
    jobParsingMessage: "Reading document structure, pages, headings, and content blocks.",
    jobAnalyzingMessage: "Comparing the research objective with themes and knowledge found across the current sources.",
    jobPlanningMessage: "Creating a controlled classification plan before extracting Wiki entries.",
    jobFilteringMessage: "Keeping the material that supports your guiding research question.",
    jobExtractingMessage: "Recording atomic evidence claims before the AI creates a global candidate catalog.",
    jobResolvingMessage: "Using AI semantic understanding to consolidate overlapping concepts into stable Wiki entries.",
    jobBuildingGraphMessage: "Connecting Wiki entries to relationships and page-level evidence.",
    jobCompletedMessage: "The evidence-linked Wiki is ready to explore, search, and question.",
    jobFailedMessage: "The build stopped before the Wiki was complete. Review the errors below.",
    jobDocumentAnalysis: "Full-document analysis batches",
    jobDocumentSynthesis: "Document synthesis batches",
    jobPlanGeneration: "Wiki structure generation",
    jobRelevance: "Relevance filtering batches",
    jobClaimExtraction: "Evidence-claim ledger batches",
    jobCandidateCatalog: "Global candidate catalog batches",
    jobSummarization: "Wiki summary batches",
    jobElapsed: "elapsed",
    documentUploaded: "Awaiting processing",
    documentParsed: "Knowledge extracted",
    documentFailed: "Processing failed",
  },
  zh: {
    delete: "移除所选内容",
    selected: "已选择",
    reprocess: "重新构建当前 Wiki",
    deleteHelp: "勾选不再需要的材料，将其移出当前研究空间。",
    brand: "证据图谱",
    eyebrow: "证据优先的 AI 研究工作台",
    hero: "把研究材料构建成可追溯的知识 Wiki。",
    lede: "先定义你真正想理解的问题，再由 AI 从材料中提取概念、关系与结论，并将每条知识连接回原始证据。",
    start: "新建知识项目",
    example: "例如：电池正极材料为什么会衰减",
    create: "创建研究空间",
    projects: "研究空间",
    total: "个项目",
    loading: "正在载入研究空间…",
    empty: "还没有研究空间。创建一个项目，把手中的材料整理成有证据支撑的 Wiki。",
    active: "Wiki 已就绪，可探索、检索与问答",
    review: "研究蓝图等待确认",
    setup: "尚未定义研究蓝图",
    created: "创建于",
    lastEdited: "最近编辑于",
    opening: "正在打开项目…",
    overview: "构建",
    graph: "知识图谱",
    search: "知识检索",
    chat: "Wiki 助手",
    chatSub: "AI 先理解你的问题，再结合当前 Wiki 分析，并标注支撑回答的文件与页码。",
    newChat: "新建研究问题",
    deleteChat: "删除研究问题",
    deleteChatConfirm: "确定删除这个研究问题及其全部消息吗？此操作无法撤销。",
    askWiki: "询问概念、机制、差异、联系或实际含义…",
    send: "提问",
    chatReady: "当前回答仅依据这一版有证据支撑的 Wiki。",
    chatUnavailable: "请先完成 Wiki 构建，再开始基于证据的问答。",
    citations: "证据出处",
    limitations: "知识边界",
    noChats: "提出一个问题，让 AI 基于当前 Wiki 进行分析。",
    workspace: "Wiki 构建台",
    workspaceSub: "定义知识边界，添加证据来源，再构建可探索、可检索、可问答的研究 Wiki。",
    exportJson: "导出结构化 Wiki",
    exportCsv: "导出节点表格",
    guide: "定义 Wiki 的知识边界",
    confirmed: "蓝图已生效",
    ready: "等待确认",
    required: "需要研究蓝图",
    help: "告诉系统哪些知识对你的研究真正重要。主 Wiki 只保留相关且能够追溯到来源的信息。",
    objective: "核心研究问题",
    objectiveHint: "希望这个 Wiki 帮助你理解、比较或预测什么？",
    domain: "研究领域",
    entityTypes: "需要保留的知识类型",
    entitiesHint: "材料、机制、方法、指标",
    relations: "需要重点连接的关系",
    relationsHint: "导致、提升、通过…测量、由…推导",
    ignore: "不进入主 Wiki 的内容",
    ignoreHint: "通用背景、无关方法、重复描述",
    customRequirements: "自定义生成要求",
    customRequirementsHint: "描述自定义分类、字段、关系逻辑、优先级或输出约束。",
    classificationDecision: "分类决策",
    semanticMembers: "语义归并成员",
    save: "保存研究蓝图",
    confirm: "确认并构建 Wiki",
    rerun: "按当前材料重新构建",
    working: "正在构建…",
    upload: "添加研究材料",
    profile: "研究蓝图",
    profileDetail: "DOCX · 描述研究目标与知识优先级",
    sources: "证据来源",
    sourceDetail: "PDF 或 DOCX · 用于构建当前 Wiki 的原始材料",
    choose: "添加文件",
    chooseMany: "添加文件",
    noFiles: "尚未添加证据来源。",
    source: "证据来源",
    processing: "Wiki 构建",
    processingHelp:
      "确认研究蓝图后，系统将读取材料、筛选相关内容、提取知识候选，并由 AI 理解语义重叠后为节点和关系绑定证据。",
    graphSub: "探索概念、方法、结论与证据之间的结构化联系。",
    searchKnowledge: "检索当前 Wiki",
    find: "定位 Wiki 节点…",
    allTypes: "全部类型",
    nodes: "个节点",
    relationsCount: "条关系",
    graphEmpty:
      "确认研究蓝图并处理证据来源后，知识图谱将在这里生成。",
    clickNode: "选择节点，查看定义、关系与证据出处",
    noProperties: "暂无可展示的结构化信息。",
    related: "关联知识",
    selectNode: "选择一个节点，打开它的 Wiki 详情。",
    searchSub: "从当前结构化 Wiki 中检索概念、别名、摘要、属性与关系。",
    searchHint: "搜索概念、方法、结论、公式或属性…",
    matching: "条 Wiki 结果",
    noSummary: "该节点尚未生成可读摘要。",
    alsoKnown: "别名",
    confidence: "置信度",
    noResults:
      "当前 Wiki 尚未收录相关知识。请尝试更宽泛的概念，或添加更多证据来源。",
    importance: "研究相关度",
    language: "切换语言",
    profileRole: "研究蓝图",
    evidenceLabel: "证据",
    evidenceFirst: "证据可追溯的研究",
    localWorkspace: "本地私有工作空间",
    wikiVersion: "Wiki 版本",
    page: "第",
    observed: "直接观察",
    reported: "来源陈述",
    inferred: "Wiki 综合分析",
    inferenceNotice: "以下为 AI 推断 · 基于证据综合",
    chatCreateError: "无法新建研究问题。",
    chatSendError: "无法完成本次 Wiki 分析。",
    chatDeleteError: "无法删除这个研究问题。",
    jobQueued: "等待构建",
    jobParsing: "正在读取材料",
    jobAnalyzing: "正在联合分析目标与材料",
    jobPlanning: "正在规划 Wiki 分类",
    jobFiltering: "正在按研究目标筛选",
    jobExtracting: "正在建立证据声明账本",
    jobResolving: "正在进行 AI 语义归并",
    jobBuildingGraph: "正在连接知识图谱",
    jobCompleted: "Wiki 已就绪",
    jobFailed: "构建中断",
    jobQueuedMessage: "证据来源已进入队列，正在等待开始构建。",
    jobParsingMessage: "正在识别文档结构、页码、标题与内容区块。",
    jobAnalyzingMessage: "正在结合核心研究问题，分析当前材料中的主题、范围与必要知识。",
    jobPlanningMessage: "正在生成受控分类计划，明确每类知识的边界与归类规则。",
    jobFilteringMessage: "正在保留能够支撑核心研究问题的材料。",
    jobExtractingMessage: "正在逐区块记录原子证据声明，随后由 AI 建立全局 Candidate 目录。",
    jobResolvingMessage: "AI 正在理解候选之间的等价、实例、侧面与特化关系，形成稳定的 Wiki 条目。",
    jobBuildingGraphMessage: "正在连接 Wiki 条目、知识关系与页级证据。",
    jobCompletedMessage: "证据可追溯的 Wiki 已经可以探索、检索与问答。",
    jobFailedMessage: "Wiki 尚未构建完成，请查看下方错误信息。",
    jobDocumentAnalysis: "整篇文档分析批次",
    jobDocumentSynthesis: "文档级知识整合批次",
    jobPlanGeneration: "Wiki 结构设计",
    jobRelevance: "相关性筛选批次",
    jobClaimExtraction: "证据声明账本批次",
    jobCandidateCatalog: "全局 Candidate 目录批次",
    jobSummarization: "Wiki 摘要批次",
    jobElapsed: "已用时",
    documentUploaded: "等待处理",
    documentParsed: "知识已提取",
    documentFailed: "处理失败",
  },
} as const;
const templateCopy = {
  en: {
    templates: "Blueprint presets",
    auto: "Smart auto-detect",
    research: "Academic papers",
    course: "Course learning",
    custom: "Custom blueprint",
    templateHint:
      "Choose a starting blueprint; every preset remains editable before building.",
     templateNoSources:
        "Blueprint applied. Add evidence sources before building the Wiki.",
    templateApplied:
      'Blueprint applied. Choose "Confirm and build Wiki" when the knowledge boundary is ready.',
  },
  zh: {
    templates: "研究蓝图预设",
    auto: "智能识别",
    research: "学术论文",
    course: "课程学习",
    custom: "自定义蓝图",
    templateHint:
      "选择一个起点；确认构建前仍可按研究目标修改全部蓝图字段。",
    templateNoSources: "研究蓝图已应用。请添加证据来源，再开始构建 Wiki。",
    templateApplied: "研究蓝图已应用。确认知识边界后即可构建 Wiki。",
  },
} as const;
type Copy = { [K in keyof typeof copy.en]: string } & {
  [K in keyof typeof templateCopy.en]: string;
};
const I18n = createContext<{
  lang: Language;
  t: Copy;
  setLang: (lang: Language) => void;
}>({
  lang: "en",
  t: { ...copy.en, ...templateCopy.en },
  setLang: () => undefined,
});
const useI18n = () => useContext(I18n);
const emptyProfile: WikiProfile = {
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
const PRESET_TEMPLATES: Record<
  "auto" | "research" | "course",
  { en: WikiProfile; zh: WikiProfile }
> = {
  research: {
    en: {
      version: "1.0",
      researchGoal: "Build an academic-paper Wiki that explains each study's research question, methods, evidence, findings, mechanisms, metrics, limitations, and points of agreement or conflict across sources.",
      domain: "Academic papers",
      entityTypes: ["concept", "claim", "method", "experiment", "mechanism", "metric"],
      importantFields: ["research question", "study object", "method", "conditions", "finding", "value", "unit", "limitation", "evidence"],
      preferredRelations: ["investigates", "measured by", "supports", "contradicts", "explains", "compares"],
      exclude: ["administrative text", "references without substantive findings"],
      extractNumericData: true,
      preserveUnits: true,
      extractTables: true,
      evidenceRequired: true,
      notes: "Keep claims tied to their study conditions. Separate reported findings from inferred synthesis and preserve limitations or conflicting evidence.",
      customRequirements: "Use the paper title, abstract, methods, results, and discussion to establish study scope. Do not merge findings from incompatible materials, samples, conditions, or populations.",
    },
    zh: {
      version: "1.0",
      researchGoal: "构建面向学术论文的 Wiki，说明每项研究的研究问题、方法、证据、发现、机制、指标、局限，以及不同来源之间的一致与冲突。",
      domain: "学术论文",
      entityTypes: ["概念", "主张", "方法", "实验", "机制", "指标"],
      importantFields: ["研究问题", "研究对象", "方法", "条件", "发现", "数值", "单位", "局限", "证据"],
      preferredRelations: ["研究对象", "测量方法", "支持", "矛盾", "解释", "对比"],
      exclude: ["行政文本", "没有实质发现的参考文献条目"],
      extractNumericData: true,
      preserveUnits: true,
      extractTables: true,
      evidenceRequired: true,
      notes: "主张必须绑定其研究条件；区分论文明确报告的发现与 AI 综合推断，并保留局限性和冲突证据。",
      customRequirements: "根据论文标题、摘要、方法、结果与讨论确定研究范围。不得合并材料、样品、条件或研究对象不兼容的发现。",
    },
  },
  auto: {
    en: {
      version: "1.0",
      researchGoal: "Identify what the uploaded materials are for and automatically design the smallest sufficient, evidence-grounded Wiki for the user's stated need.",
      domain: "Auto-detected from sources",
      entityTypes: [],
      importantFields: [],
      preferredRelations: [],
      exclude: [],
      extractNumericData: true,
      preserveUnits: true,
      extractTables: true,
      evidenceRequired: true,
      notes: "Infer the appropriate knowledge unit, fields, categories, and relations from the user's goal and the corpus. Do not impose a course or paper structure when the sources require another structure.",
      customRequirements: "First identify the source type and user task. Then propose only the reusable, evidence-supported knowledge needed for understanding, retrieval, comparison, analysis, or decision support.",
    },
    zh: {
      version: "1.0",
      researchGoal: "识别上传材料的用途，并根据使用者提出的具体需求，自动设计最小充分、证据可追溯的 Wiki。",
      domain: "由材料自动识别",
      entityTypes: [],
      importantFields: [],
      preferredRelations: [],
      exclude: [],
      extractNumericData: true,
      preserveUnits: true,
      extractTables: true,
      evidenceRequired: true,
      notes: "先从用户目标和语料判断合适的知识单元、字段、分类和关系。材料需要其他结构时，不要预设为课程或论文结构。",
      customRequirements: "先识别材料类型和用户任务；随后只保留理解、检索、比较、分析或决策所需、可由证据支撑且可跨来源复用的知识。",
    },
  },
  course: {
    en: { version: "1.0", researchGoal: "Build a course-learning Wiki that connects concepts, definitions, laws, formulas, derivations, examples, common misconceptions, and prerequisite knowledge into an explainable learning path.", domain: "Course learning", entityTypes: ["concept", "law", "formula", "method", "example", "quantity"], importantFields: ["definition", "formula", "derivation", "conditions", "example", "prerequisite", "common misconception"], preferredRelations: ["defines", "derives", "requires", "applies to", "exemplifies"], exclude: ["administrative course information"], extractNumericData: true, preserveUnits: true, extractTables: false, evidenceRequired: true, notes: "Preserve assumptions, units, sign conventions, and the conditions under which a formula, law, or method applies.", customRequirements: "Organize knowledge for learning rather than merely listing chapters. Connect prerequisites to later concepts and keep derivation steps and worked examples tied to their source material." },
    zh: { version: "1.0", researchGoal: "构建课程学习 Wiki，把概念、定义、定律、公式、推导、例题、常见误解与先修知识连接成可解释的学习路径。", domain: "课程学习", entityTypes: ["概念", "定律", "公式", "方法", "例子", "物理量"], importantFields: ["定义", "公式", "推导", "适用条件", "例子", "先修知识", "常见误解"], preferredRelations: ["定义", "推导", "依赖", "应用于", "举例"], exclude: ["课程行政信息"], extractNumericData: true, preserveUnits: true, extractTables: false, evidenceRequired: true, notes: "保留假设、单位、符号约定，以及公式、定律或方法的适用条件。", customRequirements: "按学习路径组织知识，而不是只罗列章节；连接先修知识与后续概念，并让推导步骤、例题与原始材料保持可追溯关联。" },
  },
};
type PresetTemplateId = keyof typeof PRESET_TEMPLATES;
const TEMPLATE_PRESETS: Record<PresetTemplateId, NonNullable<WikiProfile["preset"]>> = {
  auto: "auto", research: "research", course: "course",
};
const templateForProfile = (profile: WikiProfile | undefined): PresetTemplateId | "custom" => {
  if (!profile?.preset || profile.preset === "custom") return "custom";
  if (profile.preset === "auto" || profile.preset === "general") return "auto";
  return (Object.entries(TEMPLATE_PRESETS).find(([, preset]) => preset === profile.preset)?.[0] as PresetTemplateId | undefined) ?? "custom";
};
const split = (input: string) =>
  input
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
const join = (input: string[]) => input.join(", ");

export function App() {
  const [lang, setLang] = useState<Language>(() =>
    localStorage.getItem("llm-wiki-language") === "zh" ? "zh" : "en",
  );
  useEffect(() => {
    localStorage.setItem("llm-wiki-language", lang);
    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
  }, [lang]);
  return (
    <I18n.Provider
      value={{ lang, t: { ...copy[lang], ...templateCopy[lang] }, setLang }}
    >
      <Routes>
        <Route path="/" element={<ProjectList />} />
        <Route path="/projects/:projectId/*" element={<Workspace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </I18n.Provider>
  );
}
function LanguageToggle() {
  const { lang, setLang, t } = useI18n();
  return (
    <button
      type="button"
      className="language-toggle"
      onClick={() => setLang(lang === "en" ? "zh" : "en")}
      aria-label={t.language}
    >
      <span className={lang === "en" ? "selected" : ""}>EN</span>
      <i>
        <b className={lang === "zh" ? "zh" : ""} />
      </i>
      <span className={lang === "zh" ? "selected" : ""}>中</span>
    </button>
  );
}

function ProjectList() {
  const { t } = useI18n();
  const [projects, setProjects] = useState<Project[]>([]),
    [name, setName] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(true),
    [selected, setSelected] = useState<string[]>([]);
  const navigate = useNavigate();
  const load = () =>
    api
      .projects()
      .then(setProjects)
      .catch((e) => setError(e.message))
      .finally(() => setBusy(false));
  useEffect(() => {
    void load();
  }, []);
  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    try {
      const project = await api.createProject(name);
      navigate(`/projects/${project.id}`);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const remove = async () => {
    if (!selected.length) return;
    try {
      await api.deleteProjects(selected);
      setSelected([]);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <main className="landing">
      <header className="brand">
        <span className="brand-mark">✦</span>
        {t.brand}
        <LanguageToggle />
      </header>
      <section className="hero">
        <p className="eyebrow">{t.eyebrow}</p>
        <h1>{t.hero}</h1>
        <p className="lede">{t.lede}</p>
        <form className="create-card" onSubmit={create}>
          <label htmlFor="project-name">{t.start}</label>
          <div>
            <input
              id="project-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t.example}
            />
            <button>
              {t.create} <span>→</span>
            </button>
          </div>
        </form>
        {error && <Alert message={error} />}
      </section>
      <section className="project-section">
        <div className="section-title">
          <h2>{t.projects}</h2>
          <div className="project-actions">
            <span>
              {projects.length} {t.total}
            </span>
            <button
              className="button danger"
              disabled={!selected.length}
              onClick={remove}
            >
              {t.delete} ({selected.length})
            </button>
          </div>
        </div>
        {busy ? (
          <p className="muted">{t.loading}</p>
        ) : projects.length ? (
          <div className="project-grid">
            {projects.map((project) => (
              <div className="project-card" key={project.id}>
                <input
                  className="project-check"
                  type="checkbox"
                  checked={selected.includes(project.id)}
                  onChange={() =>
                    setSelected((current) =>
                      current.includes(project.id)
                        ? current.filter((id) => id !== project.id)
                        : [...current, project.id],
                    )
                  }
                />
                <Link to={`/projects/${project.id}`}>
                  <div className="project-icon">◈</div>
                  <h3>{project.name}</h3>
                  <p>
                    {project.profileConfirmed
                      ? t.active
                      : project.profile
                        ? t.review
                        : t.setup}
                  </p>
                  <small>
                    {t.created}{" "}
                    {new Date(project.createdAt).toLocaleDateString()}
                  </small>
                  <small>{t.lastEdited} {new Date(project.updatedAt ?? project.createdAt).toLocaleString()}</small>
                  <span className="arrow">→</span>
                </Link>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-state">{t.empty}</div>
        )}
      </section>
    </main>
  );
}
function Workspace() {
  const { projectId = "" } = useParams();
  const location = useLocation();
  const { t } = useI18n();
  const [snapshot, setSnapshot] = useState<ProjectSnapshot>();
  const [error, setError] = useState("");
  const load = useCallback(
    () =>
      api
        .snapshot(projectId)
        .then(setSnapshot)
        .catch((e) => setError(e.message)),
    [projectId],
  );
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!snapshot?.job || ["completed", "failed"].includes(snapshot.job.status))
      return;
    const pollJob = async () => {
      try {
        const job = await api.latestJob(projectId);
        if (["completed", "failed"].includes(job.status)) await load();
        else setSnapshot((current) => current ? { ...current, job } : current);
      } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not refresh processing status"); }
    };
    const timer = window.setInterval(() => void pollJob(), 1_000);
    return () => window.clearInterval(timer);
  }, [snapshot?.job?.id, snapshot?.job?.status, projectId, load]);
  if (error)
    return (
      <main className="page">
        <Alert message={error} />
      </main>
    );
  if (!snapshot) return <main className="page muted">{t.opening}</main>;
  return (
    <div className="workspace">
      <aside className="sidebar">
        <Link className="logo" to="/">
          <span>✦</span>
          {t.brand}
        </Link>
        <div className="project-name">{snapshot.project.name}</div>
        <nav>
          <NavLink to={`/projects/${projectId}`} end>
            {t.overview}
          </NavLink>
          <NavLink to={`/projects/${projectId}/graph`}>
            {t.graph} <b>{snapshot.nodes.length}</b>
          </NavLink>
          <NavLink to={`/projects/${projectId}/search`}>{t.search}</NavLink>
          <NavLink to={`/projects/${projectId}/chat`}>{t.chat}</NavLink>
        </nav>
        <div className="sidebar-foot">
          {t.evidenceFirst}
          <br />
          {t.localWorkspace} · v0.1
        </div>
      </aside>
      <main className={`workspace-main ${location.pathname.endsWith("/chat") ? "chat-workspace-main" : location.pathname.endsWith("/search") ? "search-workspace-main" : ""}`}>
        <Routes>
          <Route
            index
            element={<Overview snapshot={snapshot} reload={load} />}
          />
          <Route path="graph" element={<GraphView snapshot={snapshot} />} />
          <Route path="search" element={<SearchView snapshot={snapshot} />} />
          <Route path="chat" element={<ChatView snapshot={snapshot} />} />
        </Routes>
      </main>
    </div>
  );
}
function Overview({
  snapshot,
  reload,
}: {
  snapshot: ProjectSnapshot;
  reload: () => void;
}) {
  const { t, lang } = useI18n();
  const { project } = snapshot;
  const projectId = project.id;
  const buildRunning = Boolean(snapshot.job && !["completed", "failed"].includes(snapshot.job.status));
  const [profile, setProfile] = useState<WikiProfile>(
    () => overviewDrafts.get(projectId)?.profile ?? project.profile ?? emptyProfile,
  );
  const [saving, setSaving] = useState(false),
    [error, setError] = useState(""),
    [selected, setSelected] = useState<string[]>([]),
    [selectedTemplate, setSelectedTemplate] = useState<string>(
      () => overviewDrafts.get(projectId)?.selectedTemplate ?? templateForProfile(project.profile),
    ),
    [templateHint, setTemplateHint] = useState("");
  useEffect(() => {
    overviewDrafts.set(projectId, { selectedTemplate, profile });
  }, [projectId, selectedTemplate, profile]);
  // 项目切换（snapshot 更新为新项目）时，重置为该项目的草稿或服务端 profile，避免串项目
  useEffect(() => {
    const draft = overviewDrafts.get(projectId);
    setProfile(draft?.profile ?? project.profile ?? emptyProfile);
    setSelectedTemplate(draft?.selectedTemplate ?? templateForProfile(project.profile));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);
  useEffect(() => {
    setSelected((previous) =>
      previous.filter((id) => snapshot.documents.some((d) => d.id === id)),
    );
  }, [snapshot.documents]);
  const prevLang = useRef(lang);
  useEffect(() => {
    if (prevLang.current === lang) return;
    prevLang.current = lang;
    if (selectedTemplate === "custom") {
      setProfile((current) => ({ ...current, outputLanguage: lang }));
      return;
    }
    const template = PRESET_TEMPLATES[selectedTemplate as keyof typeof PRESET_TEMPLATES];
    if (!template) return;
    setProfile({ ...template[lang], preset: TEMPLATE_PRESETS[selectedTemplate as PresetTemplateId], outputLanguage: lang });
  }, [lang, selectedTemplate]);
  const update = (
    key: keyof WikiProfile,
    value: WikiProfile[keyof WikiProfile],
  ) => setProfile((previous) => ({ ...previous, [key]: value }));
  const applyTemplate = async (templateId: PresetTemplateId) => {
    const template = PRESET_TEMPLATES[templateId][lang];
    setSelectedTemplate(templateId);
    setProfile({ ...template, preset: TEMPLATE_PRESETS[templateId], outputLanguage: lang });
    setTemplateHint(
      snapshot.documents.some((document) => document.role === "source")
        ? t.templateApplied
        : t.templateNoSources,
    );
  };
  const selectCustom = () => {
    setSelectedTemplate("custom");
    setTemplateHint(t.templateHint);
    setProfile({ ...emptyProfile, preset: "custom", outputLanguage: lang });
  };
  const upload = async (
    event: ChangeEvent<HTMLInputElement>,
    role: "profile" | "source",
  ) => {
    const files = event.target.files;
    if (!files?.length) return;
    try {
      for (const file of Array.from(files))
        await api.upload(project.id, file, role);
      if (role === "profile") {
        const understood = await api.understandProfile(project.id);
        setProfile(understood.profile);
        setSelectedTemplate(templateForProfile(understood.profile));
      }
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      event.target.value = "";
    }
  };
  const save = async () => {
    setSaving(true);
    try {
      const savedProfile = { ...profile, outputLanguage: lang };
      setProfile(savedProfile);
      await api.updateProfile(project.id, savedProfile);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  const confirm = async () => {
    if (buildRunning) return;
    setSaving(true);
    try {
      const savedProfile = { ...profile, outputLanguage: lang };
      setProfile(savedProfile);
      await api.updateProfile(project.id, savedProfile);
      await api.confirm(project.id);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  const remove = async () => {
    if (!selected.length) return;
    setSaving(true);
    try {
      await api.deleteDocuments(project.id, selected);
      setSelected([]);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  const toggle = (id: string) =>
    setSelected((current) =>
      current.includes(id)
        ? current.filter((value) => value !== id)
        : [...current, id],
    );
  return (
    <>
      <PageHeader
        title={t.workspace}
        subtitle={t.workspaceSub}
        actions={
          <>
            <a
              className="button ghost"
              href={api.exportUrl(project.id, "json")}
            >
              {t.exportJson}
            </a>
            <a className="button ghost" href={api.exportUrl(project.id, "csv")}>
              {t.exportCsv}
            </a>
          </>
        }
      />
      {error && <Alert message={error} />}
      <div className="overview-grid">
        <section className="panel profile-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">01 · {t.profile}</p>
              <h2>{t.guide}</h2>
            </div>
            <Status
              label={
                project.profileConfirmed
                  ? t.confirmed
                  : project.profile
                    ? t.ready
                    : t.required
              }
              tone={project.profileConfirmed ? "good" : "pending"}
            />
          </div>
          <p className="help">{t.help}</p>
          <div className="template-picker" aria-label={t.templates}>
            <div>
              <span>{t.templates}</span>
              <small>{t.templateHint}</small>
            </div>
            <div className="template-chips">
              {([
                ["auto", t.auto],
                ["research", t.research],
                ["course", t.course],
              ] as const).map(([id, label]) => (
                <button key={id} type="button" className={selectedTemplate === id ? "selected" : ""} disabled={saving} onClick={() => void applyTemplate(id)}>{label}</button>
              ))}
              <button type="button" className={selectedTemplate === "custom" ? "selected" : ""} disabled={saving} onClick={selectCustom}>{t.custom}</button>
            </div>
          </div>
          {templateHint && <p className="template-help">{templateHint}</p>}
          <Field label={t.objective}>
            <textarea
              value={profile.researchGoal}
              onChange={(e) => update("researchGoal", e.target.value)}
              placeholder={t.objectiveHint}
            />
          </Field>
          <div className="field-row">
            <Field label={t.domain}>
              <input
                value={profile.domain}
                onChange={(e) => update("domain", e.target.value)}
              />
            </Field>
            <Field label={t.entityTypes}>
              <input
                value={join(profile.entityTypes)}
                onChange={(e) => update("entityTypes", split(e.target.value))}
                placeholder={t.entitiesHint}
              />
            </Field>
          </div>
          <div className="field-row">
            <Field label={t.relations}>
              <input
                value={join(profile.preferredRelations)}
                onChange={(e) =>
                  update("preferredRelations", split(e.target.value))
                }
                placeholder={t.relationsHint}
              />
            </Field>
            <Field label={t.ignore}>
              <input
                value={join(profile.exclude)}
                onChange={(e) => update("exclude", split(e.target.value))}
                placeholder={t.ignoreHint}
              />
            </Field>
          </div>
          <Field label={t.customRequirements}>
            <textarea
              value={profile.customRequirements ?? ""}
              onChange={(e) => update("customRequirements", e.target.value)}
              placeholder={t.customRequirementsHint}
            />
          </Field>
          <div className="actions">
            <button className="button ghost" disabled={saving} onClick={save}>
              {t.save}
            </button>
            <button
              className="button primary"
              disabled={saving || buildRunning || !(profile.researchGoal ?? "").trim()}
              onClick={confirm}
            >
              {saving || buildRunning
                ? t.working
                : project.profileConfirmed
                  ? t.reprocess
                  : t.confirm}{" "}
              <span>→</span>
            </button>
          </div>
        </section>
        <section className="right-stack">
          <section className="panel upload-panel">
            <p className="eyebrow">02 · {t.sources}</p>
            <h2>{t.upload}</h2>
            <UploadBox
              label={t.profile}
              detail={t.profileDetail}
              accept=".docx"
              onChange={(e) => void upload(e, "profile")}
            />
            <UploadBox
              label={t.sources}
              detail={t.sourceDetail}
              accept=".pdf,.docx"
              multiple
              onChange={(e) => void upload(e, "source")}
            />
            <div className="document-actions">
              <span>
                {selected.length} {t.selected}
              </span>
              <button
                className="button danger"
                disabled={!selected.length || saving}
                onClick={remove}
              >
                {t.delete}
              </button>
            </div>
            <p className="selection-help">{t.deleteHelp}</p>
            <div className="document-list">
              {snapshot.documents.length ? (
                snapshot.documents.map((d) => (
                  <label className="document" key={d.id}>
                    <input
                      type="checkbox"
                      checked={selected.includes(d.id)}
                      onChange={() => toggle(d.id)}
                    />
                    <span className="doc-icon">{d.kind.toUpperCase()}</span>
                    <div>
                      <strong>{d.fileName}</strong>
                      <small>
                        {d.role === "profile" ? t.profileRole : t.source} ·{" "}
                        {d.status === "parsed" ? t.documentParsed : d.status === "failed" ? t.documentFailed : t.documentUploaded}
                      </small>
                    </div>
                  </label>
                ))
              ) : (
                <p className="muted">{t.noFiles}</p>
              )}
            </div>
          </section>
          <JobPanel snapshot={snapshot} />
        </section>
      </div>
    </>
  );
}
function highlightEvidence(text: string, term: string): string {
  if (!text) return "";
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  if (!term) return escaped;
  const tokens = term
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!tokens.length) return escaped;
  const pattern = tokens.join("|");
  return escaped.replace(new RegExp(`(${pattern})`, "gi"), "<mark>$1</mark>");
}
function GraphView({ snapshot }: { snapshot: ProjectSnapshot }) {
  const { t, lang } = useI18n();
  const [selected, setSelected] = useState<WikiNode | undefined>(
    snapshot.nodes[0],
  );
  const [query, setQuery] = useState(""),
    [type, setType] = useState("all");
  const [zoom, setZoom] = useState(1),
    [pan, setPan] = useState({ x: 0, y: 0 });
  const viewRef = useRef({ zoom: 1, pan: { x: 0, y: 0 } });
  const dragRef = useRef<{ x: number; y: number } | undefined>(undefined);
  const types = useMemo(
    () =>
      [...new Set(snapshot.nodes.map((node) => node.type.trim()))].sort(),
    [snapshot.nodes],
  );
  const colorFor = (type: string) =>
    TYPE_COLORS[types.indexOf(type.trim()) % TYPE_COLORS.length];
  const nodes = useMemo(
    () =>
      snapshot.nodes.filter(
        (n) =>
          (type === "all" || n.type.trim() === type.trim()) &&
          `${n.displayName} ${n.summary}`
            .toLowerCase()
            .includes(query.toLowerCase()),
      ),
    [snapshot.nodes, type, query],
  );
  const shown = useMemo(() => new Set(nodes.map((n) => n.id)), [nodes]);
  const edges = useMemo(
    () =>
      snapshot.edges.filter(
        (e) => shown.has(e.sourceNodeId) && shown.has(e.targetNodeId),
      ),
    [snapshot.edges, shown],
  );
  const layout = useMemo(() => layoutNodes(nodes, edges), [nodes, edges]);
  const positions = layout.positions;
  const evidence = selected
    ? snapshot.evidence.filter((item) => selected.evidenceIds.includes(item.id))
    : [];
  const docNames = useMemo(
    () => new Map(snapshot.documents.map((d) => [d.id, d.fileName])),
    [snapshot.documents],
  );
  const related = selected
    ? snapshot.nodes.filter(
        (n) =>
          n.id !== selected.id &&
          snapshot.edges.some(
            (e) =>
              (e.sourceNodeId === selected.id && e.targetNodeId === n.id) ||
              (e.targetNodeId === selected.id && e.sourceNodeId === n.id),
          ),
      )
    : [];
  const transform = `translate(${pan.x} ${pan.y}) scale(${zoom})`;
  const canvasRef = useRef<HTMLDivElement>(null);
  const updateView = useCallback((nextZoom: number, nextPan: { x: number; y: number }) => {
    viewRef.current = { zoom: nextZoom, pan: nextPan };
    setZoom(nextZoom);
    setPan(nextPan);
  }, []);
  useEffect(() => {
    // A filtered layout has a new viewBox. Resetting its transform lets SVG's centered
    // viewBox alignment place the reduced set in the middle instead of retaining old pan.
    updateView(1, { x: 0, y: 0 });
    setSelected(current => current && nodes.some(node => node.id === current.id) ? current : nodes[0]);
  }, [nodes, updateView]);
  useEffect(() => {
    const element = canvasRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const pointer = {
        x: (event.clientX - rect.left) * (layout.width / rect.width),
        y: (event.clientY - rect.top) * (layout.height / rect.height),
      };
      const current = viewRef.current;
      const nextZoom = Math.max(0.1, Math.min(20, current.zoom * (event.deltaY < 0 ? 1.12 : 0.89)));
      const worldPoint = {
        x: (pointer.x - current.pan.x) / current.zoom,
        y: (pointer.y - current.pan.y) / current.zoom,
      };
      updateView(nextZoom, {
        x: pointer.x - worldPoint.x * nextZoom,
        y: pointer.y - worldPoint.y * nextZoom,
      });
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [layout.height, layout.width]);
  return (
    <>
      <PageHeader
        title={t.graph}
        subtitle={t.graphSub}
        actions={
          <Link
            className="button ghost"
            to={`/projects/${snapshot.project.id}/search`}
          >
            {t.searchKnowledge}
          </Link>
        }
      />
      <div className="graph-toolbar">
        <input
          aria-label={t.find}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t.find}
        />
        <select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="all">{t.allTypes}</option>
          {types.map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
        <span>
          {nodes.length} {t.nodes} · {edges.length} {t.relationsCount}
        </span>
      </div>
      {!nodes.length ? (
        <div className="empty-state graph-empty">{t.graphEmpty}</div>
      ) : (
        <div className="graph-layout">
          <section className="graph-canvas" ref={canvasRef}>
            <div className="graph-legend">
              {types.map((legendType) => (
                <div className="legend-item" key={legendType}>
                  <span
                    className="legend-dot"
                    style={{ background: colorFor(legendType) }}
                  />
                  <span>{legendType}</span>
                </div>
              ))}
            </div>
            <svg
              viewBox={`0 0 ${layout.width} ${layout.height}`}
              onPointerDown={(e) => {
                e.preventDefault();
                dragRef.current = { x: e.clientX, y: e.clientY };
                e.currentTarget.setPointerCapture(e.pointerId);
              }}
              onPointerMove={(e) => {
                const drag = dragRef.current;
                if (drag) {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const current = viewRef.current;
                  updateView(current.zoom, {
                    x: current.pan.x + (e.clientX - drag.x) * (layout.width / rect.width),
                    y: current.pan.y + (e.clientY - drag.y) * (layout.height / rect.height),
                  });
                  dragRef.current = { x: e.clientX, y: e.clientY };
                }
              }}
              onPointerUp={(e) => {
                dragRef.current = undefined;
                e.currentTarget.releasePointerCapture(e.pointerId);
              }}
              onPointerCancel={() => { dragRef.current = undefined; }}
            >
              <g transform={transform}>
                {edges.map((edge) => {
                  const a = positions.get(edge.sourceNodeId),
                    b = positions.get(edge.targetNodeId);
                  return a && b ? (
                    <line
                      key={edge.id}
                      x1={a.x}
                      y1={a.y}
                      x2={b.x}
                      y2={b.y}
                      className={
                        edge.relationStatus === "inferred"
                          ? "graph-line inferred"
                          : "graph-line"
                      }
                    />
                  ) : null;
                })}
                {nodes.map((node) => {
                  const p = positions.get(node.id)!;
                  const active = selected?.id === node.id;
                  const radius = 6 + node.importance * 6;
                  const labelAnchor = p.x < layout.center.x - 4 ? "end" : p.x > layout.center.x + 4 ? "start" : "middle";
                  const labelX = p.x < layout.center.x - 4 ? -radius - 5 : p.x > layout.center.x + 4 ? radius + 5 : 0;
                  const labelY = Math.abs(p.x - layout.center.x) <= 4 ? (p.y < layout.center.y ? -radius - 6 : radius + 14) : 4;
                  return (
                    <g
                      key={node.id}
                      className="graph-node"
                      transform={`translate(${p.x} ${p.y})`}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        setSelected(node);
                      }}
                    >
                      <circle
                        r={active ? radius + 3 : radius}
                        fill={active ? "#152338" : colorFor(node.type)}
                        style={{ fill: active ? "#152338" : colorFor(node.type) }}
                        className={active ? "active" : ""}
                      />
                      {zoom >= 0.6 && (
                        <text x={labelX} y={labelY} textAnchor={labelAnchor}>
                          {node.displayName.slice(0, 24)}
                        </text>
                      )}
                    </g>
                  );
                })}
              </g>
            </svg>
          </section>
          <aside className="node-detail">
            {selected ? (
              <>
                <p className="eyebrow">{selected.type}</p>
                <h2>{selected.displayName}</h2>
                <p>{selected.summary || t.noSummary}</p>
                <Metric
                  label={t.confidence}
                  value={`${Math.round(selected.confidence * 100)}%`}
                />
                <Metric
                  label={t.importance}
                  value={`${Math.round(selected.importance * 100)}%`}
                />
                {selected.classification ? (
                  <>
                    <h3>{t.classificationDecision}</h3>
                    <p className="muted">
                      {selected.classification.status === "accepted"
                        ? (lang === "zh" ? "已验证" : "Validated")
                        : selected.classification.status === "corrected"
                          ? (lang === "zh" ? "已自动纠正" : "Auto-corrected")
                          : (lang === "zh" ? "需要复核" : "Needs review")}
                      {` · ${Math.round(selected.classification.confidence * 100)}%`}
                    </p>
                    {selected.classification.semanticExplanation ? (
                      <p>{selected.classification.semanticExplanation}</p>
                    ) : null}
                    <p className="muted">{selected.classification.reason}</p>
                  </>
                ) : null}
                {(selected.semanticMembers?.length ?? 0) > 1 ? (
                  <>
                    <h3>{t.semanticMembers}</h3>
                    <ul className="semantic-members">
                      {selected.semanticMembers?.map((member) => (
                        <li key={member.candidateId}>
                          <strong>{member.name}</strong>
                          <span className="type-pill">{member.action}</span>
                          {member.scope ? <small>{member.scope}</small> : null}
                          <p className="muted">{member.reason}</p>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
                <h3>{t.related}</h3>
                {related.length ? (
                  <div className="related-list">
                    {related.map((n) => (
                      <button
                        key={n.id}
                        className="related-chip"
                        onClick={() => setSelected(n)}
                      >
                        {n.displayName}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="muted">{t.noProperties}</p>
                )}
                <h3>{t.evidenceLabel}</h3>
                {evidence.length ? (
                  evidence.map((item) => (
                    <article className="evidence" key={item.id}>
                      <header>
                        <span className="evidence-src">
                          {docNames.get(item.documentId) ?? t.source}
                        </span>
                        <span className="evidence-page">{lang === "zh" ? `第 ${item.page} 页` : `${t.page} ${item.page}`}</span>
                        <span className="evidence-status">{item.status === "observed" ? t.observed : item.status === "inferred" ? t.inferred : t.reported}</span>
                      </header>
                      <p
                        dangerouslySetInnerHTML={{
                          __html: highlightEvidence(
                            item.originalText,
                            selected.displayName,
                          ),
                        }}
                      />
                      <small>{item.section ?? item.blockId}</small>
                    </article>
                  ))
                ) : (
                  <p className="muted">{t.noProperties}</p>
                )}
              </>
            ) : (
              <p className="muted">{t.selectNode}</p>
            )}
          </aside>
        </div>
      )}
    </>
  );
}
const TYPE_COLORS = [
  "#6c5ce7",
  "#e17055",
  "#00b894",
  "#f39c12",
  "#0984e3",
  "#e84393",
  "#00cec9",
  "#a29bfe",
  "#d63031",
  "#636e72",
];

type GraphLayout = {
  positions: Map<string, { x: number; y: number }>;
  center: { x: number; y: number };
  maxOuterRadius: number;
  width: number;
  height: number;
};

function layoutNodes(nodes: WikiNode[], _edges: ProjectSnapshot["edges"]): GraphLayout {
  const count = nodes.length;
  const positions = new Map<string, { x: number; y: number }>();
  if (!count) {
    return { positions, center: { x: 400, y: 300 }, maxOuterRadius: 0, width: 800, height: 600 };
  }

  // The layout grows with the data set. Labels are capped at the same 24
  // characters used by the renderer, so the arc budget remains predictable.
  const labelWidth = 24 * 7;
  const typeCount = new Set(nodes.map((node) => node.type.trim())).size;
  const maxPerLayer = Math.max(
    10,
    Math.min(
      14,
      Math.floor((2 * Math.PI * (220 + Math.sqrt(count) * 18 + typeCount * 18)) / (labelWidth + 28)),
    ),
  );
  const radialLayerSpacing = Math.max(16, Math.min(22, 14 + Math.sqrt(count)));
  const innerRadius = Math.max(64, Math.min(120, 54 + typeCount * 4 + Math.sqrt(count) * 2));
  const gap = Math.max(12, Math.min(24, 10 + Math.sqrt(count) * 0.6));

  if (count === 1) {
    const center = { x: 120, y: 100 };
    positions.set(nodes[0].id, center);
    return { positions, center, maxOuterRadius: 0, width: 240, height: 200 };
  }

  // One concentric band per type; first appearance still determines inner-to-outer order.
  const groups = new Map<string, WikiNode[]>();
  for (const node of nodes) {
    const type = node.type.trim();
    const list = groups.get(type) ?? [];
    list.push(node);
    groups.set(type, list);
  }
  const typeOrder = [...groups.keys()];
  const layerCounts = typeOrder.map((type) => Math.max(1, Math.ceil(groups.get(type)!.length / maxPerLayer)));
  const bandWidth = Math.max(28, Math.max(...layerCounts) * radialLayerSpacing);
  const maxOuterRadius = innerRadius + typeOrder.length * bandWidth + (typeOrder.length - 1) * gap;
  const padding = labelWidth + 36;
  const center = { x: maxOuterRadius + padding, y: maxOuterRadius + padding };
  typeOrder.forEach((type, g) => {
    const group = groups.get(type)!;
    const bandStart = innerRadius + g * (bandWidth + gap);
    const layers = layerCounts[g];
    group.forEach((node, j) => {
      const layer = Math.floor(j / maxPerLayer);
      const layerNodes = group.slice(layer * maxPerLayer, Math.min(group.length, (layer + 1) * maxPerLayer));
      const indexInLayer = j - layer * maxPerLayer;
      const radius = bandStart + (bandWidth * (layer + 0.5)) / layers;
      const angle = (Math.PI * 2 * indexInLayer) / layerNodes.length +
        (layer % 2 ? Math.PI / layerNodes.length : 0);
      positions.set(node.id, {
        x: center.x + Math.cos(angle) * radius,
        y: center.y + Math.sin(angle) * radius,
      });
    });
  });
  return {
    positions,
    center,
    maxOuterRadius,
    width: center.x * 2,
    height: center.y * 2,
  };
}

function SearchView({ snapshot }: { snapshot: ProjectSnapshot }) {
  const { t } = useI18n();
  const [query, setQuery] = useState(""),
    [results, setResults] = useState<WikiNode[]>(snapshot.nodes);
  const search = async () => {
    const normalizedQuery = query.replace(/\s+/g, " ").trim();
    setResults((await api.search(snapshot.project.id, normalizedQuery)).nodes);
  };
  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    void search();
  };
  const onSearchKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void search();
  };
  return (
    <>
      <PageHeader
        title={t.searchKnowledge}
        subtitle={t.searchSub}
        actions={
          <a
            className="button ghost"
            href={api.exportUrl(snapshot.project.id, "csv")}
          >
            {t.exportCsv}
          </a>
        }
      />
      <section className="search-panel">
        <form className="search-form" onSubmit={submitSearch}>
          <textarea
            autoFocus
            rows={1}
            className="search-input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onSearchKeyDown}
            placeholder={t.searchHint}
          />
          <button className="button primary" type="submit">{t.search}</button>
        </form>
        <p className="muted">
          {results.length} {t.matching}
        </p>
        <div className="search-results">
          {results.map((node) => (
            <article key={node.id}>
              <div>
                <span className="type-pill">{node.type}</span>
                <h2>{node.displayName}</h2>
                <p>{node.summary || t.noSummary}</p>
                {node.aliases.length > 0 && (
                  <small>
                    {t.alsoKnown}: {node.aliases.join(", ")}
                  </small>
                )}
              </div>
              <div className="score">
                {Math.round(node.confidence * 100)}
                <small>{t.confidence}</small>
              </div>
            </article>
          ))}
          {!results.length && <div className="empty-state">{t.noResults}</div>}
        </div>
      </section>
    </>
  );
}
function renderBareChemistry(content: string, keyPrefix: number) {
  return content.split(/(\n)/).map((line, lineIndex) => {
    if (line === "\n") return line;
    const colonMatch = line.match(/^(.*?[：:]\s*)(.+)$/u);
    const prefix = colonMatch?.[1] ?? "";
    let candidate = (colonMatch?.[2] ?? line).trim();
    const suffixMatch = candidate.match(/([。；;，,]+)$/u);
    const suffix = suffixMatch?.[1] ?? "";
    if (suffix) candidate = candidate.slice(0, -suffix.length).trimEnd();
    const hasReactionArrow = /(?:→|⇌|->|<=>)/u.test(candidate);
    const elementCount = candidate.match(/[A-Z][a-z]?/g)?.length ?? 0;
    if (!hasReactionArrow || elementCount < 2 || /[\p{Script=Han}]/u.test(candidate)) return line;
    const mhchem = candidate
      .replace(/⇌/gu, "<=>")
      .replace(/→/gu, "->")
      .replace(/\b([a-z])(?=[A-Z])/gu, "$1 ");
    const tex = `\\ce{${mhchem}}`;
    return <span key={`chem-${keyPrefix}-${lineIndex}`}>{prefix}<span className="chat-math" dangerouslySetInnerHTML={{ __html: katex.renderToString(tex, { throwOnError: false, trust: false }) }} />{suffix}</span>;
  });
}
function normalizeChatMath(content: string) {
  const formulaLike = (value: string) =>
    !/[\p{Script=Han}]/u.test(value)
    && /(?:=|≈|≤|≥|≠|∝|\\(?:frac|sum|int|vec|mathbf|mathrm)\b|[A-Za-zα-ωΑ-Ω]\s*(?:_|\^|[*/×]))/u.test(value);
  const toLatex = (value: string) => toWikiLatex(value)
    .replace(/²/gu, "^2")
    .replace(/³/gu, "^3")
    .replace(/·/gu, "\\cdot ");
  return content
    .replace(/\\\[([\s\S]+?)\\\]/gu, "$$$$$1$$$$")
    .replace(/\\\(([^\n]+?)\\\)/gu, "$$$1$")
    .replace(/((?:公式|方程)(?:为|是)?\s*|(?:formula|equation)(?:\s+is)?\s*)([^。\n]+)(?=。|\n|$)/giu, (full, prefix: string, candidate: string) => {
      const trimmed = candidate.trim();
      return formulaLike(trimmed) ? `${prefix}$${toLatex(trimmed)}$` : full;
    });
}

function renderChatText(content: string) {
  return normalizeChatMath(content).split(/(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$)/g).map((part, index) => {
    const display = part.startsWith("$$") && part.endsWith("$$");
    const inline = !display && part.startsWith("$") && part.endsWith("$");
    if (!display && !inline) return renderBareChemistry(part, index);
    const tex = part.slice(display ? 2 : 1, display ? -2 : -1).trim();
    return <span key={`${index}-${tex}`} className={display ? "chat-math display" : "chat-math"} dangerouslySetInnerHTML={{ __html: katex.renderToString(tex, { displayMode: display, throwOnError: false, trust: false }) }} />;
  });
}

// Earlier Wiki-chat records may contain IDs that were once returned in prose.
// Citations are rendered separately, so hide implementation identifiers without
// changing the saved message or the server-side evidence binding.
function readableChatContent(content: string) {
  const taggedIdentifier = String.raw`(?:(?:node|evidence)(?:\s*id)?|节点|证据)\s*[:：#]?\s*[a-z0-9][a-z0-9:_-]{7,}`;
  return content
    .replace(new RegExp(String.raw`[（(]\s*(?:${taggedIdentifier}\s*[,，、;；]?\s*)+[）)]`, "giu"), "")
    .replace(new RegExp(taggedIdentifier, "giu"), "")
    .replace(/\b[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\b/giu, "")
    .replace(/[（(]\s*[,，、;；\s]*[）)]/gu, "")
    .replace(/[，,、]\s*[，,、]+/gu, "，")
    .replace(/\s{2,}/gu, " ")
    .trim();
}

function toWikiLatex(formula: string) {
  const greek: Record<string, string> = {
    α: "\\alpha", β: "\\beta", γ: "\\gamma", Δ: "\\Delta", θ: "\\theta",
    λ: "\\lambda", μ: "\\mu", π: "\\pi", ρ: "\\rho", τ: "\\tau", φ: "\\phi", ω: "\\omega",
  };
  return formula
    .replace(/[αβγΔθλμπρτφω]/gu, (symbol) => greek[symbol])
    .replace(/_([A-Za-z0-9]+(?:,[A-Za-z0-9]+)?)/g, "_{$1}")
    .replace(/\*/g, "\\cdot ")
    .replace(/≈/g, "\\approx ")
    .replace(/≤/g, "\\le ")
    .replace(/≥/g, "\\ge ")
    .replace(/≠/g, "\\ne ")
    .replace(/∝/g, "\\propto ")
    .replace(/√/g, "\\sqrt ");
}

function ChatClaimStatuses({ claims }: { claims: ChatClaim[] }) {
  const { t } = useI18n();
  const counts = claims.reduce<Record<string, number>>((current, claim) => ({ ...current, [claim.status]: (current[claim.status] ?? 0) + 1 }), {});
  return <div className="chat-claims">{Object.entries(counts).map(([status, count]) => <span key={status} className={`claim-status ${status}`}>{status === "observed" ? t.observed : status === "inferred" ? t.inferenceNotice : t.reported} × {count}</span>)}</div>;
}
function chatCitationLabel(citation: ChatCitation, language: Language, pageLabel: string, snapshot: ProjectSnapshot) {
  const documentName = citation.documentName.replace(/\.(pdf|docx)$/i, "");
  const location = language === "zh" ? `第 ${citation.page} 页` : `${pageLabel} ${citation.page}`;
  const citedNode = citation.nodeId ? snapshot.nodes.find(node => node.id === citation.nodeId) : undefined;
  const evidenceNode = snapshot.nodes.find(node => node.evidenceIds.includes(citation.evidenceId));
  const topic = citation.topic ?? citedNode?.displayName ?? evidenceNode?.displayName ?? citation.section;
  return [documentName, location, topic].filter(Boolean).join(" · ");
}
function ChatView({ snapshot }: { snapshot: ProjectSnapshot }) {
  const { t, lang } = useI18n();
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const messagesRef = useRef<HTMLDivElement>(null);
  const ready = snapshot.job?.status === "completed" && snapshot.nodes.length > 0;
  const loadThreads = useCallback(async () => {
    const next = await api.chatThreads(snapshot.project.id);
    setThreads(next);
    setActiveThreadId((current) => current && next.some((thread) => thread.id === current) ? current : (next[0]?.id ?? ""));
  }, [snapshot.project.id]);
  useEffect(() => { void loadThreads().catch((reason: Error) => setError(reason.message)); }, [loadThreads]);
  useEffect(() => {
    if (!activeThreadId) { setMessages([]); return; }
    void api.chatMessages(snapshot.project.id, activeThreadId).then(setMessages).catch((reason: Error) => setError(reason.message));
  }, [activeThreadId, snapshot.project.id]);
  useEffect(() => {
    const messageList = messagesRef.current;
    if (messageList) messageList.scrollTop = messageList.scrollHeight;
  }, [messages]);
  const createThread = async () => {
    try {
      setError("");
      const thread = await api.createChatThread(snapshot.project.id);
      setThreads((current) => [thread, ...current]);
      setActiveThreadId(thread.id);
      setMessages([]);
    } catch (reason) { setError(reason instanceof Error ? reason.message : t.chatCreateError); }
  };
  const deleteThread = async (threadId: string) => {
    if (!window.confirm(t.deleteChatConfirm)) return;
    try {
      setError("");
      await api.deleteChatThread(snapshot.project.id, threadId);
      setThreads((current) => current.filter((thread) => thread.id !== threadId));
      if (activeThreadId === threadId) {
        setActiveThreadId((current) => current === threadId ? "" : current);
        setMessages([]);
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : t.chatDeleteError); }
  };
  const send = async () => {
    const question = draft.trim();
    if (!question || sending || !ready) return;
    try {
      setSending(true); setError("");
      let threadId = activeThreadId;
      let createdThread = false;
      if (!threadId) {
        const thread = await api.createChatThread(snapshot.project.id);
        threadId = thread.id;
        createdThread = true;
      }
      const reply = await api.sendChatMessage(snapshot.project.id, threadId, question);
      if (createdThread) {
        setActiveThreadId(threadId);
        setMessages([reply.user, reply.assistant]);
      } else setMessages((current) => [...current, reply.user, reply.assistant]);
      setDraft("");
      await loadThreads();
    } catch (reason) { setError(reason instanceof Error ? reason.message : t.chatSendError); }
    finally { setSending(false); }
  };
  const submitChat = (event: FormEvent) => {
    event.preventDefault();
    void send();
  };
  const onChatKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void send();
  };
  return (
    <>
      <PageHeader title={t.chat} subtitle={t.chatSub} actions={<button className="button" disabled={!ready} onClick={() => void createThread()}>{t.newChat}</button>} />
      {!ready ? <Alert message={t.chatUnavailable} /> : null}
      {error ? <Alert message={error} /> : null}
      <section className="chat-layout">
        <aside className="chat-threads">
          {threads.length ? threads.map((thread) => <div key={thread.id} className={`chat-thread ${thread.id === activeThreadId ? "active" : ""}`}><button className="chat-thread-select" onClick={() => setActiveThreadId(thread.id)}><strong>{thread.title}</strong><small>{t.wikiVersion} {thread.wikiRevision}</small></button><button className="chat-thread-delete" type="button" onClick={() => void deleteThread(thread.id)} aria-label={`${t.deleteChat}: ${thread.title}`} title={t.deleteChat}>×</button></div>) : <p className="muted">{t.noChats}</p>}
        </aside>
        <div className="chat-panel">
          <p className="chat-revision">{t.chatReady} · {t.wikiVersion} {snapshot.project.wikiRevision ?? 0}</p>
          <div className="chat-messages" ref={messagesRef} aria-live="polite">
            {messages.map((message) => <article className={`chat-message ${message.role}`} key={message.id}>
              <div className="chat-message-content">{renderChatText(readableChatContent(message.content))}</div>
              {message.answer?.claims.length ? <ChatClaimStatuses claims={message.answer.claims} /> : null}
              {message.answer?.citations.length ? <div className="chat-citations"><strong>{t.citations}</strong>{message.answer.citations.map((citation) => <span key={citation.evidenceId}>{chatCitationLabel(citation, lang, t.page, snapshot)}</span>)}</div> : null}
              {message.answer?.limitations.length ? <div className="chat-limitations"><strong>{t.limitations}</strong>{message.answer.limitations.map((item) => <span key={item}>{item}</span>)}</div> : null}
            </article>)}
          </div>
          <form className="chat-compose" onSubmit={submitChat}>
            <textarea value={draft} disabled={!ready || sending} onChange={(event) => setDraft(event.target.value)} onKeyDown={onChatKeyDown} placeholder={t.askWiki} />
            <button className="button primary" disabled={!ready || sending || !draft.trim()}>{sending ? "…" : t.send}</button>
          </form>
        </div>
      </section>
    </>
  );
}
function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle: string;
  actions?: React.ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      <div className="header-actions">
        {actions}
        <LanguageToggle />
      </div>
    </header>
  );
}
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
function UploadBox(props: {
  label: string;
  detail: string;
  accept: string;
  multiple?: boolean;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  const { t } = useI18n();
  return (
    <label className="upload-box">
      <input
        type="file"
        accept={props.accept}
        multiple={props.multiple}
        onChange={props.onChange}
      />
      <span className="upload-icon">↑</span>
      <strong>{props.label}</strong>
      <small>{props.detail}</small>
      <em>{props.multiple ? t.chooseMany : t.choose}</em>
    </label>
  );
}
function Status({ label, tone }: { label: string; tone: "good" | "pending" }) {
  return <span className={`status ${tone}`}>{label}</span>;
}
function Alert({ message }: { message: string }) {
  return (
    <div className="alert" role="alert">
      {message}
    </div>
  );
}
function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
function JobPanel({ snapshot }: { snapshot: ProjectSnapshot }) {
  const { t } = useI18n();
  const job = snapshot.job;
  const presentation = job ? {
    queued: { label: t.jobQueued, message: t.jobQueuedMessage },
    parsing: { label: t.jobParsing, message: t.jobParsingMessage },
    analyzing: { label: t.jobAnalyzing, message: t.jobAnalyzingMessage },
    planning: { label: t.jobPlanning, message: t.jobPlanningMessage },
    filtering: { label: t.jobFiltering, message: t.jobFilteringMessage },
    extracting: { label: t.jobExtracting, message: t.jobExtractingMessage },
    resolving: { label: t.jobResolving, message: t.jobResolvingMessage },
    building_graph: { label: t.jobBuildingGraph, message: t.jobBuildingGraphMessage },
    completed: { label: t.jobCompleted, message: t.jobCompletedMessage },
    failed: { label: t.jobFailed, message: t.jobFailedMessage },
  }[job.status] : undefined;
  const batch = job?.batchProgress;
  const batchLabel = batch ? {
    document_analysis: t.jobDocumentAnalysis,
    document_synthesis: t.jobDocumentSynthesis,
    plan_generation: t.jobPlanGeneration,
    relevance: t.jobRelevance,
    extraction: t.jobClaimExtraction,
    claim_extraction: t.jobClaimExtraction,
    candidate_catalog: t.jobCandidateCatalog,
    semantic_consolidation: t.jobResolving,
    wiki_summarization: t.jobSummarization,
  }[batch.phase] : undefined;
  const elapsed = batch
    ? batch.elapsedSeconds >= 60
      ? `${Math.floor(batch.elapsedSeconds / 60)}m ${batch.elapsedSeconds % 60}s`
      : `${batch.elapsedSeconds}s`
    : undefined;
  return (
    <section className="panel job-panel">
      <p className="eyebrow">03 · {t.processing}</p>
      <h2>{t.processing}</h2>
      {job ? (
        <>
          <div className="job-head">
            <Status
              label={presentation?.label ?? job.status}
              tone={job.status === "completed" ? "good" : "pending"}
            />
            <strong>{job.progress}%</strong>
          </div>
          <div className="progress">
            <i style={{ width: `${job.progress}%` }} />
          </div>
          <p>{presentation?.message ?? job.message}</p>
          {batch && batchLabel && (
            <p className="muted">{batchLabel}：{batch.completed}/{batch.total} · {t.jobElapsed} {elapsed}</p>
          )}
          {job.errors.map((error) => (
            <Alert key={error} message={error} />
          ))}
        </>
      ) : (
        <p className="muted">{t.processingHelp}</p>
      )}
    </section>
  );
}
function position(index: number, total: number) {
  const a = (Math.PI * 2 * index) / Math.max(total, 1) - Math.PI / 2,
    r = Math.min(180, 58 + total * 13);
  return { x: 400 + Math.cos(a) * r, y: 260 + Math.sin(a) * r };
}

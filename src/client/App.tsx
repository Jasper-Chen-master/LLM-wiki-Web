import {
  createContext,
  type ChangeEvent,
  type FormEvent,
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
  useNavigate,
  useParams,
} from "react-router-dom";
import type {
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
    delete: "Delete selected",
    selected: "selected",
    reprocess: "Process current documents",
    deleteHelp: "Select one or more uploaded documents, then remove them.",
    brand: "Evidence Atlas",
    eyebrow: "GOAL-CONDITIONED RESEARCH WORKSPACE",
    hero: "Turn papers into a traceable knowledge space.",
    lede: "Build an evidence-backed research wiki shaped by the questions that matter to you—not a generic document summary.",
    start: "Start a research project",
    example: "e.g. Battery cathode degradation",
    create: "Create project",
    projects: "Your projects",
    total: "total",
    loading: "Loading workspace…",
    empty:
      "No projects yet. Create one above to begin a focused research workspace.",
    active: "Knowledge graph active",
    review: "Profile ready for review",
    setup: "Set up research profile",
    created: "Created",
    opening: "Opening project…",
    overview: "Overview",
    graph: "Knowledge graph",
    search: "Search",
    workspace: "Research workspace",
    workspaceSub:
      "Define what matters, then build an evidence-bound knowledge graph.",
    exportJson: "Export JSON",
    exportCsv: "Export CSV",
    guide: "Guide the extraction",
    confirmed: "Confirmed",
    ready: "Ready for review",
    required: "Required",
    help: "Describe the knowledge this wiki should retain. The profile is validated before processing starts.",
    objective: "Research objective",
    objectiveHint: "What question should this wiki help answer?",
    domain: "Research domain",
    entityTypes: "Important entity types",
    entitiesHint: "material, process, metric",
    relations: "Preferred relations",
    relationsHint: "improves, causes, measured by",
    ignore: "Information to ignore",
    ignoreHint: "background, unrelated synthesis",
    preferences: "Additional preferences",
    preferencesHint:
      "Numerical data, units, and evidence are preserved by default.",
    numeric: "Extract numerical data",
    units: "Preserve units",
    evidence: "Require evidence",
    save: "Save profile",
    confirm: "Confirm & build graph",
    rerun: "Run processing again",
    working: "Working…",
    upload: "Upload documents",
    profile: "Research Profile",
    profileDetail: "DOCX · your goals and priorities",
    sources: "Source papers",
    sourceDetail: "PDF or DOCX · up to 20 MB each",
    choose: "Choose file",
    chooseMany: "Choose files",
    noFiles: "No files uploaded yet.",
    source: "Source document",
    processing: "Pipeline status",
    processingHelp:
      "Confirm the research profile to start parsing, relevance filtering, extraction, entity resolution, and graph construction.",
    graphSub: "Explore only knowledge retained by your research profile.",
    searchKnowledge: "Search knowledge",
    find: "Find a node…",
    allTypes: "All types",
    nodes: "nodes",
    relationsCount: "relations",
    graphEmpty:
      "The graph will appear here once profile confirmation and processing complete. Evidence stays attached to every extracted node and relation.",
    clickNode: "Click a node to inspect its evidence",
    properties: "Properties",
    noProperties: "No structured properties.",
    related: "Related nodes",
    selectNode: "Select a node.",
    searchSub:
      "Search canonical names, aliases, summaries, and structured graph knowledge.",
    searchHint: "Search entities, properties, or concepts…",
    matching: "matching nodes",
    noSummary: "No summary available.",
    alsoKnown: "Also known as",
    confidence: "confidence",
    noResults:
      "No matching structured knowledge. Try a broader term or process more source documents.",
    importance: "Importance",
    language: "Switch language",
    profileRole: "Research profile",
    evidenceLabel: "Evidence",
  },
  zh: {
    delete: "删除所选文件",
    selected: "已选择",
    reprocess: "处理当前文档",
    deleteHelp: "勾选一个或多个已上传文件后即可删除。",
    brand: "证据图谱",
    eyebrow: "目标驱动的研究知识空间",
    hero: "让论文沉淀为可追溯的知识空间。",
    lede: "围绕你真正关心的问题，构建以证据为依据的研究 Wiki，而不是泛泛的文档摘要。",
    start: "创建研究项目",
    example: "例如：电池正极材料衰减",
    create: "创建项目",
    projects: "我的项目",
    total: "个项目",
    loading: "正在加载工作空间…",
    empty: "还没有项目。请在上方创建一个项目，开启目标导向的研究工作流。",
    active: "知识图谱已就绪",
    review: "偏好等待审阅",
    setup: "设置研究偏好",
    created: "创建于",
    opening: "正在打开项目…",
    overview: "概览",
    graph: "知识图谱",
    search: "搜索",
    workspace: "研究工作空间",
    workspaceSub: "先定义真正重要的信息，再构建有证据支撑的知识图谱。",
    exportJson: "导出 JSON",
    exportCsv: "导出 CSV",
    guide: "设定提取重点",
    confirmed: "已确认",
    ready: "待审阅",
    required: "需要设置",
    help: "描述此 Wiki 应保留的知识。系统会在开始处理前校验研究偏好。",
    objective: "研究目标",
    objectiveHint: "希望这个 Wiki 帮助回答什么问题？",
    domain: "研究领域",
    entityTypes: "重要实体类型",
    entitiesHint: "材料、工艺、指标",
    relations: "重点关系",
    relationsHint: "提升、导致、通过…测量",
    ignore: "需要忽略的信息",
    ignoreHint: "背景介绍、无关的合成过程",
    preferences: "其他偏好",
    preferencesHint: "默认保留数值、单位与证据来源。",
    numeric: "提取数值数据",
    units: "保留单位",
    evidence: "必须保留证据",
    save: "保存偏好",
    confirm: "确认并构建图谱",
    rerun: "再次运行处理",
    working: "处理中…",
    upload: "上传文档",
    profile: "研究偏好",
    profileDetail: "DOCX · 说明研究目标与关注重点",
    sources: "源文档",
    sourceDetail: "PDF 或 DOCX · 单个文件不超过 20 MB",
    choose: "选择文件",
    chooseMany: "选择文件",
    noFiles: "尚未上传文件。",
    source: "源文档",
    processing: "处理进度",
    processingHelp:
      "确认研究偏好后，系统将依次执行解析、相关性筛选、信息抽取、实体归并与图谱构建。",
    graphSub: "探索经研究偏好筛选后保留的知识。",
    searchKnowledge: "搜索知识",
    find: "查找节点…",
    allTypes: "全部类型",
    nodes: "个节点",
    relationsCount: "条关系",
    graphEmpty:
      "确认研究偏好并完成处理后，知识图谱将显示在这里。每个节点和关系都会保留证据来源。",
    clickNode: "点击节点查看证据",
    properties: "属性",
    noProperties: "暂无结构化属性。",
    related: "相关节点",
    selectNode: "请选择一个节点。",
    searchSub: "检索规范名称、别名、摘要与结构化图谱知识。",
    searchHint: "搜索实体、属性或概念…",
    matching: "个匹配节点",
    noSummary: "暂无摘要。",
    alsoKnown: "别名",
    confidence: "置信度",
    noResults:
      "未找到匹配的结构化知识。请尝试更宽泛的关键词，或处理更多源文档。",
    importance: "重要度",
    language: "切换语言",
    profileRole: "研究偏好",
    evidenceLabel: "证据",
  },
} as const;
const templateCopy = {
  en: {
    templates: "Templates",
    research: "Research",
    reading: "Reading",
    personalGrowth: "Personal Growth",
    general: "General",
    business: "Business",
    custom: "Custom",
    outputLanguage: "Output language",
    templateHint:
      "Pick a template to pre-fill the profile, or choose Custom to upload your own profile document.",
     templateNoSources:
       "Template applied. Upload source documents before building the knowledge graph.",
    templateApplied:
      'Template applied. Click "Confirm & build graph" to start processing.',
  },
  zh: {
    templates: "模板",
    research: "学术研究",
    reading: "阅读笔记",
    personalGrowth: "个人成长",
    general: "通用",
    business: "商业分析",
    custom: "自定义",
    outputLanguage: "输出语言",
    templateHint:
      "选择一个模板自动填充提取偏好，或选择「自定义」上传你自己的研究偏好文件。",
    templateNoSources: "模板已填充。请先上传源文档，再构建知识图谱。",
    templateApplied: "模板已填充。点击“确认并构建图谱”开始处理。",
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
};
const PRESET_TEMPLATES: Record<
  "research" | "reading" | "personal-growth" | "general" | "business",
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
  reading: {
    en: {
    version: "1.0",
    researchGoal:
      "Capture the key arguments, claims, and concepts from the reading, and map how the author builds and supports them.",
    domain: "Reading notes",
    entityTypes: ["topic", "argument", "claim", "concept", "term", "example"],
    importantFields: ["main point", "argument", "example", "definition"],
    preferredRelations: [
      "supports",
      "refutes",
      "leads to",
      "exemplifies",
      "contrasts with",
    ],
    exclude: [],
    extractNumericData: false,
    preserveUnits: false,
    extractTables: false,
    evidenceRequired: true,
    notes: "",
    },
    zh: {
      version: "1.0",
      researchGoal: "捕捉阅读材料中的关键论点、主张与概念，梳理作者如何构建并支持论证。",
      domain: "阅读笔记",
      entityTypes: ["主题", "论点", "主张", "概念", "术语", "例子"],
      importantFields: ["核心观点", "论证", "例子", "定义"],
      preferredRelations: ["支持", "反驳", "引出", "举例", "对比"],
      exclude: [],
      extractNumericData: false,
      preserveUnits: false,
      extractTables: false,
      evidenceRequired: true,
      notes: "",
    },
  },
  "personal-growth": {
    en: {
    version: "1.0",
    researchGoal:
      "Extract actionable advice, habits, methods, and mental models that can be applied to improve oneself.",
    domain: "Personal growth",
    entityTypes: [
      "habit",
      "method",
      "principle",
      "mindset",
      "tool",
      "action item",
    ],
    importantFields: ["advice", "steps", "principle", "action"],
    preferredRelations: [
      "enables",
      "requires",
      "practices",
      "applies",
      "avoids",
    ],
    exclude: [],
    extractNumericData: false,
    preserveUnits: false,
    extractTables: false,
    evidenceRequired: true,
    notes: "",
    },
    zh: {
      version: "1.0",
      researchGoal: "提取可行动的建议、习惯、方法与心智模型，用于自我提升。",
      domain: "个人成长",
      entityTypes: ["习惯", "方法", "原则", "心态", "工具", "行动项"],
      importantFields: ["建议", "步骤", "原则", "行动"],
      preferredRelations: ["促成", "需要", "实践", "应用", "避免"],
      exclude: [],
      extractNumericData: false,
      preserveUnits: false,
      extractTables: false,
      evidenceRequired: true,
      notes: "",
    },
  },
  general: {
    en: {
    version: "1.0",
    researchGoal:
      "Build a comprehensive knowledge map of the key concepts, entities, and relationships found in the document.",
    domain: "General knowledge",
    entityTypes: ["concept", "entity", "attribute", "event", "data point"],
    importantFields: ["definition", "attribute", "relationship"],
    preferredRelations: ["relates to", "contains", "belongs to", "affects"],
    exclude: [],
    extractNumericData: true,
    preserveUnits: true,
    extractTables: false,
    evidenceRequired: true,
    notes: "",
    },
    zh: {
      version: "1.0",
      researchGoal: "构建文档中关键概念、实体与关系的全面知识图谱。",
      domain: "通用知识",
      entityTypes: ["概念", "实体", "属性", "事件", "数据点"],
      importantFields: ["定义", "属性", "关系"],
      preferredRelations: ["相关", "包含", "属于", "影响"],
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
    const timer = window.setInterval(() => void load(), 1800);
    return () => window.clearInterval(timer);
  }, [snapshot?.job, load]);
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
        </nav>
        <div className="sidebar-foot">
          {t.evidenceLabel}-first research
          <br />
          Local MVP · v0.1
        </div>
      </aside>
      <main className="workspace-main">
        <Routes>
          <Route
            index
            element={<Overview snapshot={snapshot} reload={load} />}
          />
          <Route path="graph" element={<GraphView snapshot={snapshot} />} />
          <Route path="search" element={<SearchView snapshot={snapshot} />} />
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
  const [profile, setProfile] = useState<WikiProfile>(
    () => overviewDrafts.get(projectId)?.profile ?? project.profile ?? emptyProfile,
  );
  const [saving, setSaving] = useState(false),
    [error, setError] = useState(""),
    [selected, setSelected] = useState<string[]>([]),
    [selectedTemplate, setSelectedTemplate] = useState<string>(
      () => overviewDrafts.get(projectId)?.selectedTemplate ?? "custom",
    ),
    [templateHint, setTemplateHint] = useState("");
  useEffect(() => {
    overviewDrafts.set(projectId, { selectedTemplate, profile });
  }, [projectId, selectedTemplate, profile]);
  // 项目切换（snapshot 更新为新项目）时，重置为该项目的草稿或服务端 profile，避免串项目
  useEffect(() => {
    const draft = overviewDrafts.get(projectId);
    setProfile(draft?.profile ?? project.profile ?? emptyProfile);
    setSelectedTemplate(draft?.selectedTemplate ?? "custom");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);
  useEffect(() => {
    setSelected((previous) =>
      previous.filter((id) => snapshot.documents.some((d) => d.id === id)),
    );
  }, [snapshot.documents]);
  const prevLang = useRef(lang);
  useEffect(() => {
    if (selectedTemplate === "custom") return;
    if (prevLang.current === lang) return;
    prevLang.current = lang;
    const template = PRESET_TEMPLATES[selectedTemplate as keyof typeof PRESET_TEMPLATES];
    if (!template) return;
    setProfile({ ...template[lang] });
  }, [lang, selectedTemplate]);
  const update = (
    key: keyof WikiProfile,
    value: WikiProfile[keyof WikiProfile],
  ) => setProfile((previous) => ({ ...previous, [key]: value }));
  const applyTemplate = async (templateId: keyof typeof PRESET_TEMPLATES) => {
    const template = PRESET_TEMPLATES[templateId][lang];
    setSelectedTemplate(templateId);
    setProfile({ ...template });
    setTemplateHint(
      snapshot.documents.some((document) => document.role === "source")
        ? t.templateApplied
        : t.templateNoSources,
    );
  };
  const selectCustom = () => {
    setSelectedTemplate("custom");
    setTemplateHint(t.templateHint);
    setProfile({ ...emptyProfile });
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
      if (role === "profile") await api.understandProfile(project.id);
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
      await api.updateProfile(project.id, profile);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  const confirm = async () => {
    setSaving(true);
    try {
      await api.updateProfile(project.id, profile);
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
                ["research", t.research],
                ["reading", t.reading],
                ["personal-growth", t.personalGrowth],
                ["general", t.general],
                ["business", t.business],
              ] as const).map(([id, label]) => (
                <button key={id} type="button" className={selectedTemplate === id ? "selected" : ""} disabled={saving} onClick={() => void applyTemplate(id)}>{label}</button>
              ))}
              <button type="button" className={selectedTemplate === "custom" ? "selected" : ""} disabled={saving} onClick={selectCustom}>{t.custom}</button>
            </div>
          </div>
          {templateHint && <p className="template-help">{templateHint}</p>}
          <div className="output-lang">
            <label htmlFor="output-language">{t.outputLanguage}</label>
            <select
              id="output-language"
              value={profile.outputLanguage ?? lang}
              onChange={(e) =>
                update("outputLanguage", e.target.value as "en" | "zh")
              }
            >
              <option value="en">English</option>
              <option value="zh">中文</option>
            </select>
          </div>
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
          <Field label={t.preferences}>
            <textarea
              value={profile.notes}
              onChange={(e) => update("notes", e.target.value)}
              placeholder={t.preferencesHint}
            />
          </Field>
          <div className="toggles">
            <Toggle
              label={t.numeric}
              checked={profile.extractNumericData}
              onChange={(v) => update("extractNumericData", v)}
            />
            <Toggle
              label={t.units}
              checked={profile.preserveUnits}
              onChange={(v) => update("preserveUnits", v)}
            />
            <Toggle
              label={t.evidence}
              checked={profile.evidenceRequired}
              onChange={(v) => update("evidenceRequired", v)}
            />
          </div>
          <div className="actions">
            <button className="button ghost" disabled={saving} onClick={save}>
              {t.save}
            </button>
            <button
              className="button primary"
              disabled={saving || !(profile.researchGoal ?? "").trim()}
              onClick={confirm}
            >
              {saving
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
                        {d.status}
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
  const { t } = useI18n();
  const [selected, setSelected] = useState<WikiNode | undefined>(
    snapshot.nodes[0],
  );
  const [query, setQuery] = useState(""),
    [type, setType] = useState("all");
  const [zoom, setZoom] = useState(1),
    [pan, setPan] = useState({ x: 0, y: 0 }),
    [drag, setDrag] = useState<{ x: number; y: number }>();
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
  useEffect(() => {
    const element = canvasRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      setZoom((value) =>
        Math.max(0.1, Math.min(20, value * (event.deltaY < 0 ? 1.12 : 0.89))),
      );
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, []);
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
        <button
          className="button"
          onClick={() => {
            setZoom(1);
            setPan({ x: 0, y: 0 });
          }}
        >
          Fit
        </button>
        <span>
          {nodes.length} {t.nodes} · {edges.length} {t.relationsCount}
        </span>
      </div>
      {!nodes.length ? (
        <div className="empty-state graph-empty">{t.graphEmpty}</div>
      ) : (
        <div className="graph-layout">
          <section className="graph-canvas" ref={canvasRef}>
            <div className="graph-hint">
              滚轮缩放 · 拖拽平移 · 点击节点查看证据
            </div>
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
              onPointerDown={(e) => setDrag({ x: e.clientX, y: e.clientY })}
              onPointerMove={(e) => {
                if (drag) {
                  setPan((value) => ({
                    x: value.x + e.clientX - drag.x,
                    y: value.y + e.clientY - drag.y,
                  }));
                  setDrag({ x: e.clientX, y: e.clientY });
                }
              }}
              onPointerUp={() => setDrag(undefined)}
              onPointerLeave={() => setDrag(undefined)}
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
                      onClick={(e) => {
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
                <h3>{t.properties}</h3>
                {Object.keys(selected.properties).length ? (
                  <dl>
                    {Object.entries(selected.properties).map(([key, value]) => (
                      <div key={key}>
                        <dt>{key}</dt>
                        <dd>{String(value)}</dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <p className="muted">{t.noProperties}</p>
                )}
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
                          {docNames.get(item.documentId) ?? "source"}
                        </span>
                        <span className="evidence-page">p. {item.page}</span>
                        <span className="evidence-status">{item.status}</span>
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
  const search = async (value: string) => {
    setQuery(value);
    setResults((await api.search(snapshot.project.id, value)).nodes);
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
        <input
          autoFocus
          className="search-input"
          value={query}
          onChange={(e) => void search(e.target.value)}
          placeholder={t.searchHint}
        />
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
function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="toggle">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span />
      {label}
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
  return (
    <section className="panel job-panel">
      <p className="eyebrow">03 · {t.processing}</p>
      <h2>{t.processing}</h2>
      {job ? (
        <>
          <div className="job-head">
            <Status
              label={job.status.replace("_", " ")}
              tone={job.status === "completed" ? "good" : "pending"}
            />
            <strong>{job.progress}%</strong>
          </div>
          <div className="progress">
            <i style={{ width: `${job.progress}%` }} />
          </div>
          <p>{job.message}</p>
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

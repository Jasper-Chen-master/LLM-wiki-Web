# Codex 独立审查报告

> 审查对象：`E:\LLM wiki Web`（React/Vite + Express/TypeScript）。  
> 审查方式：仅只读检查代码、配置、Git 跟踪状态，并执行 `npm run typecheck` 与 `npm test`；未安装依赖、未启动常驻服务。  
> 本报告中的优先级含义：P0 = 可能造成数据丢失、未授权访问或阻断开源使用；P1 = 显著阻碍扩展或持续验证；P2 = 应在下一轮工程治理中收敛。

## 总览

1. 项目已经具备比典型快速原型更清晰的领域雏形：共享合同、LLM 抽象、原始文档解析、作业编排、图谱和聊天检索均有独立文件。
2. 证据优先的关键约束实现较好：图谱构建会拒绝没有真实 evidence/block 引用的实体与关系，而聊天回答也会在服务端重绑并校验引用。
3. 结构化 LLM 输出有 Zod 验证和一次修复重试；网络重试与 JSON/schema 修复重试分离，属于可持续质量的良好基础。
4. 最大架构债务是 `src/client/App.tsx` 的 2064 行单文件；其同时承担路由、工作区、图、搜索、聊天、国际化、布局及状态管理，任何 UI 演进都会增加回归面。
5. 后端 HTTP 层也在积累“上帝文件”倾向：`index.ts` 直接持有 Store、组装快照、文件生命周期、项目/profile/job/search/export 路由和错误处理中间件。
6. `data/workspace.json` 的单文件写入仅能串行化单进程写操作；它没有原子提交、备份/恢复、锁、版本迁移或加载期 schema 验证，损坏时会静默得到空工作区。
7. 当前 LLM 的低层接口可替换，但工厂、配置和状态 API 仍只表达 OpenRouter；它不是“用户逐次提供任意 DeepSeek/OpenAI 兼容 BYOK”的完整实现。
8. 已经写出的 `search-service.ts` 与 `export-service.ts` 未被 HTTP 路由调用；运行路径保留了更简单的内联实现，造成行为、测试与预期设计分叉。
9. 错误在用户界面多数能显示，但服务端没有结构化日志、request/job correlation ID 或失败原因指标；而管线若干批处理错误会被吞掉，造成“完成但空结果”难以排查。
10. 上传仅检查文件名扩展名，且 Multer 在业务校验前已经把文件写入磁盘；同时启用了无鉴权静态 uploads 与全开放 CORS，部署到非本机环境前必须收紧。
11. 质量门禁目前只有 typecheck 和单元测试；没有 lint、format、CI、提交钩子或端到端/API 路由测试。此次只读执行结果为：typecheck 通过，Vitest 9 个测试文件、55 项测试全部通过。
12. `dist/`、`dist-server/`、`data/` 与 `uploads/` 均被忽略，`git ls-files` 未显示已提交构建产物；这一点符合仓库卫生要求，但构建清理和发布产物策略尚未明确。

## A. 架构分层与模块边界

### A-1 前端单体组件成为高回归面

- 描述：`App.tsx` 达 2064 行，`Workspace`、`Overview`、`GraphView`、`SearchView`、`ChatView` 及布局/国际化/同步逻辑共处同一文件；局部 UI 或数据流修改需要阅读大量无关逻辑，难以做独立组件测试和按功能拆分交付。
- 证据：[src/client/App.tsx:576]、[src/client/App.tsx:739]、[src/client/App.tsx:1215]、[src/client/App.tsx:1828]、[src/client/App.tsx:2064]。
- 建议：按 feature 拆为 `features/projects`、`profile`、`graph`、`search`、`chat`，将 API 查询/轮询置入 hooks，将图布局和渲染拆开；先保持现有 `ProjectSnapshot` 作为页面数据合同，再以组件测试锁定拆分行为。
- 优先级：P1。

### A-2 HTTP 入口聚合了过多职责，且实现重复

- 描述：`index.ts` 同时创建应用与 Store、执行启动恢复、管理上传/删除、解析 profile、触发 job、实现搜索和导出。特别是搜索和导出在 route 内重新实现，绕过了已有服务，未来修正筛选、CSV 转义或新增格式时会发生分叉。
- 证据：[src/server/index.ts:20]、[src/server/index.ts:65]、[src/server/index.ts:68]、[src/server/index.ts:72]、[src/server/index.ts:73]；已有但未被引用的实现见 [src/server/services/search-service.ts:12]、[src/server/services/export-service.ts:7]。
- 建议：建立 `routes/projects`、`routes/documents`、`routes/knowledge`、`routes/export`，由 controller 调用 service；删除 route 中的内联搜索/导出，统一调用服务并为 route 做集成测试。将 app 构造导出为 `createApp()`，监听端口留在 bootstrap，便于测试。
- 优先级：P1。

### A-3 共享合同覆盖核心模型，但边界没有统一的运行时契约

- 描述：`contracts.ts` 对 Wiki Profile、聊天输入/输出用了 Zod，但持久化状态是 TypeScript interface，HTTP 搜索/export 响应也由 route 临时拼装。Store 加载时直接断言 `Partial<PersistedState>`，前后端因此仍可在运行时漂移。
- 证据：[src/shared/contracts.ts:127]、[src/shared/contracts.ts:135]、[src/server/store.ts:5]、[src/server/store.ts:14]、[src/server/index.ts:72]、[src/client/api.ts:33]。
- 建议：为 `PersistedState`、项目 snapshot、search/export request/response 增加 Zod schema，并从同一 schema 推导类型；以 DTO 隐藏 `storagePath` 等服务器内部字段。把 schema 的解析置于 Store 读取和每个 route 的出入口。
- 优先级：P1。

### A-4 文档解析入口存在兼容层而非清晰的可注册解析器

- 描述：job 通过 `parsing/document-parser.ts` 间接导入，而 profile route 直接导入上层 parser；该文件只是 re-export，格式选择仍集中在 `if (kind === "docx")`。现阶段可工作，但新格式会继续膨胀为条件分支。
- 证据：[src/server/job-runner.ts:4]、[src/server/index.ts:15]、[src/server/parsing/document-parser.ts:2]、[src/server/document-parser.ts:114]。
- 建议：定义 `DocumentParser` 注册表（`kind`、扩展名/MIME、sniff、parse），由同一 registry 为上传校验与解析分派提供事实来源；移除仅为兼容存在的转发入口。
- 优先级：P2。

## B. 可扩展性演练

### B-1 新增一个 LLM provider：约 5–7 处，低层接口可复用但工厂/配置仍硬编码

- 描述：`LLMProvider.generate()` 和 `generateStructured()` 足以承载新的兼容 provider，管线和聊天都依赖接口而非 OpenRouter 类，这是正面基础；但 factory 只识别 `OPENROUTER_API_KEY`，状态 API 和前端类型也只返回 `openrouter | demo`，配置说明只暴露 OpenRouter。
- 证据：[src/server/llm-provider.ts:12]、[src/server/llm-provider.ts:53]、[src/server/llm-provider.ts:103]、[src/server/ai/provider.ts:534]、[src/server/index.ts:24]、[src/client/api.ts:14]、[.env.example:7]。
- 建议：新增 `ProviderConfig`/`ProviderFactory`（provider id、base URL、model、key 引用），分别实现 DeepSeek 和 OpenAI-compatible adapter；`ai-status` 仅返回非敏感 provider/model 状态；补 provider contract tests。预估改动：provider 模块、配置 schema/加载、状态 DTO、`.env.example`/README、测试，约 5–7 个位置；无需改 extraction/chat 业务服务。
- 优先级：P1。

### B-2 新增一种文档格式：约 6 处，当前支持集有多处重复声明

- 描述：格式集合同时存在于共享枚举、上传 route 扩展名白名单、前端 `accept`/文案和 parser 分支。新增例如 Markdown 或 PPTX 时必须同步多改，否则可能“可上传不可解析”或“可解析不可选”。
- 证据：[src/shared/contracts.ts:3]、[src/server/index.ts:65]、[src/server/document-parser.ts:114]、[src/client/App.tsx:1153]、[src/client/App.tsx:1162]。
- 建议：把格式能力放入前述 parser registry，并由其生成 accept、角色允许范围和服务端校验；每个格式补正常、伪装 MIME、损坏文件、超限文件测试。预估改动：合同/registry、新 parser、上传校验、前端文案/accept、测试、文档，约 6 处。
- 优先级：P1。

### B-3 新增一种导出格式：约 4–5 处，但当前服务层未接入运行路径

- 描述：`export-service.ts` 已具备 JSON/CSV 格式函数与 CSV 转义，但 API route 使用另一套仅导出 node 简表的 CSV 代码。新增 GraphML/Markdown/XLSX 时，若沿 route 实现会继续复制；若沿 service 实现又不会被 API 调用。
- 证据：[src/server/services/export-service.ts:3]、[src/server/services/export-service.ts:9]、[src/server/index.ts:73]、[src/client/api.ts:34]。
- 建议：定义 `ExportFormat` 合同和 exporter registry，route 只负责选择格式、Content-Type 和安全下载文件名；复用 `exportKnowledgeCsv`，再新增格式实现。补含逗号/换行/引号、evidence、空图谱和 selected/search result 的测试。预估改动：合同、export service、route、client/UI、测试/文档，约 4–5 处。
- 优先级：P1。

### B-4 Prompt 集中度总体合格，但 profile prompt 仍内嵌于 provider

- 描述：生成与聊天 prompt 集中在 `src/server/prompts/`，利于版本化和测试；Research Profile 的长 prompt 却仍在 `llm-provider.ts`，新增 provider/任务时会混合 transport 与提示词维护。
- 证据：[src/server/ai/provider.ts:16]、[src/server/prompts/wiki-generation.ts:1]、[src/server/prompts/wiki-chat.ts:1]、[src/server/llm-provider.ts:110]。
- 建议：将 `profilePrompt` 与 system prompt 移至 `prompts/profile.ts`，令 provider 层只处理请求、超时、重试和响应解码；用测试固定 prompt 的注入隔离要求。
- 优先级：P2。

## C. 数据层健壮性

### C-1 单文件直接覆盖写入，崩溃或磁盘问题可损坏全部工作区

- 描述：Save chain 只能保证本 Node 进程内串行，随后直接 `writeFile(workspace.json)`；写入中断会留下截断 JSON。下次 load 的任何异常都会静默改为 `empty()`，即以“空系统”替代恢复或明确失败。
- 证据：[src/server/store.ts:10]、[src/server/store.ts:27]、[src/server/store.ts:29]、[src/server/store.ts:21]。
- 建议：短期采用同目录临时文件 + `fsync` + 原子 rename，并轮转 `.bak`；加载失败时保留损坏文件、尝试备份并以显式 degraded 状态启动。中期迁移 SQLite（事务、WAL、备份），文件对象仍只存路径/元数据。
- 优先级：P0。

### C-2 缺少跨进程锁、schema 版本和可审计迁移

- 描述：状态文件没有 `schemaVersion`，读取后不经 Zod 验证；两份 server 实例会各自把内存快照覆盖到同一文件。现有仅为 `wikiRevision` 和 `updatedAt` 的就地兼容赋值，无法管理结构变更或回滚。
- 证据：[src/server/store.ts:5]、[src/server/store.ts:14]、[src/server/store.ts:16]、[src/shared/contracts.ts:127]。
- 建议：在持久化根对象加递增 `schemaVersion`、显式 migration 链和 load-time schema parse；单文件方案至少加独占锁并明确单实例限制，数据库方案使用事务 migration。为旧版本、未知未来版本、部分损坏与两进程竞争补测试。
- 优先级：P0。

### C-3 文件元数据、磁盘文件和领域记录不是事务性生命周期

- 描述：上传时 Multer 已落盘，随后才校验 role/扩展名并保存元数据；拒绝的文件不会清理。删除时先忽略 unlink 错误，再从 Store 删除记录，磁盘残留不被报告；项目删除同样忽略文件删除失败。
- 证据：[src/server/index.ts:22]、[src/server/index.ts:28]、[src/server/index.ts:65]、[src/server/index.ts:66]。
- 建议：使用 `fileFilter`/内存或 quarantine 区先验证，再以生成的 storage ID 原子移动；失败时清理临时文件并记录告警。删除操作采用可重试的 outbox/垃圾回收状态，定期核对 metadata 与 uploads。
- 优先级：P1。

## D. 错误处理与可观测性

### D-1 route 层错误语义不一致，核心路由缺少统一 controller 包装

- 描述：聊天 router 显式把异常交给 `next`，但多数项目路由是单行 async handler；Express 5 会转发 rejected promise，却缺少统一的错误码映射、错误上下文、可预期的错误 envelope。全局 handler 直接返回 `err.message`，可能将底层实现细节暴露给客户端。
- 证据：[src/server/routes/chat-routes.ts:10]、[src/server/index.ts:27]、[src/server/index.ts:65]、[src/server/index.ts:74]、[package.json:17]。
- 建议：创建 `asyncRoute`、`AppError` 与稳定 `{ code, message, requestId }` envelope；在 controller 将 Zod、文件、provider、Store 错误映射为 4xx/5xx，日志保留原始 cause，客户端仅展示可操作消息。
- 优先级：P1。

### D-2 管线对多类 LLM 失败安全降级，但会吞掉可诊断信号

- 描述：批次 relevance/extraction/semantic/classification 多处 catch 后返回空值或 fallback，作业可能以 completed 结束而没有保留 provider 状态、批次 ID、尝试次数和被丢弃条目。结构化输出本身有验证，是优点；问题是失败信息没有进入 job error log 或指标。
- 证据：[src/server/llm-provider.ts:26]、[src/server/ai/provider.ts:351]、[src/server/ai/provider.ts:362]、[src/server/ai/provider.ts:436]、[src/server/ai/provider.ts:490]、[src/server/job-runner.ts:175]。
- 建议：为每批返回 `{ result, diagnostics }`，把可恢复失败累计到 `ProcessingJob.errors`（脱敏）及结构化日志；定义部分失败阈值，超过阈值标记 `completed_with_warnings` 或 `failed`，前端显示“跳过了多少块及原因”。
- 优先级：P1。

### D-3 没有结构化日志、追踪关联或运行指标

- 描述：检查范围内唯一 `console` 输出只是 server 启动；没有 JSON logger、request ID、project/job ID、LLM latency/token/重试指标，也没有未处理异常/拒绝处理。问题发生后不能关联“某次上传—某个 job—某个模型批次”。
- 证据：[src/server/index.ts:75]、[src/server/job-runner.ts:28]、[src/server/llm-provider.ts:63]。
- 建议：引入轻量结构化 logger（或自建 JSON event adapter），所有 request/job/provider 调用携带 requestId、projectId、jobId、stage；记录耗时、状态、重试、错误分类，严禁记录 API key、完整原文与完整 prompt。
- 优先级：P1。

### D-4 前端搜索失败会形成未处理 Promise，错误链路不完整

- 描述：工作区、聊天多数操作会设定 `error` 并显示 Alert；但 `SearchView.search()` 直接 await API，事件处理只 `void search()`，网络/5xx 错误不显示给用户，可能成为 unhandled rejection。
- 证据：[src/client/App.tsx:959]、[src/client/App.tsx:1667]、[src/client/App.tsx:1673]、[src/client/App.tsx:1908]。
- 建议：搜索 feature 自身维护 `error/loading`，所有用户触发的 async 操作通过统一 `runAction` 包装；为 API error、超时和取消请求提供一致的可恢复提示。
- 优先级：P2。

## E. 测试与质量门禁

### E-1 现有测试清单与覆盖判断

- 描述：现有测试为 `math-rendering`（客户端渲染）、`provider-optimization`（结构化输出/批处理）、`job-runner`（恢复/并发）、`wiki-generation prompts`、`evidence-focus`、`graph-relation-validation`、`wiki-chat`、`wiki-planning`、`preset-profiles`。它们覆盖若干纯服务和核心 evidence/chat 校验，但未覆盖 HTTP route、上传、parser、Store 恢复、真实导出/搜索 service。
- 证据：[package.json:14]、[src/client/math-rendering.test.ts:1]、[src/server/ai/provider-optimization.test.ts:1]、[src/server/job-runner.test.ts:1]、[src/server/services/wiki-chat.test.ts:1]、[src/server/services/graph-relation-validation.test.ts:1]。
- 建议：保留上述快速单测；新增以临时目录执行的 Store/文件/route 集成测试，并为外部 LLM 使用 fake provider，不能消耗真实 key。此次检查实测：`npm run typecheck` 通过；`npm test` 为 9 files / 55 tests passed。
- 优先级：P1。

### E-2 关键生成管线与 evidence 引用缺少端到端回归保护

- 描述：虽然图谱关系和聊天引用已有单测，尚未看到从上传/解析/相关性筛选/抽取到 `buildGraph`、持久化和 API response 的完整 happy path 与失败路径测试；parser 文件也没有 `*.test.ts`。这会使未来拆分 provider 或文档格式时难以验证 Evidence→Document→Block 的完整链路。
- 证据：[src/server/document-parser.ts:54]、[src/server/document-parser.ts:114]、[src/server/job-runner.ts:118]、[src/server/services/graph-service.ts:217]、[src/server/services/graph-relation-validation.test.ts:1]。
- 建议：用小型 fixture PDF/DOCX 和 fake provider 覆盖：解析 block ID、LLM 伪造/跨项目/缺失 evidence ID 被拒绝、删除文档后引用级联裁剪、job 部分失败、聊天 citation 绑定。将这些作为 PR 必跑项。
- 优先级：P1。

### E-3 缺失 lint、format、CI 与提交前质量门

- 描述：scripts 只有 build/typecheck/test，没有 ESLint、Prettier、覆盖率或 CI workflow；这解释了单行巨型 route、未使用 service 等问题很难被持续发现。
- 证据：[package.json:5]、[package.json:14]、[src/server/index.ts:27]、[src/server/index.ts:73]。
- 建议：最低门禁为 `npm run typecheck && npm test && npm run lint && npm run format:check`；CI 在 PR 中执行并上传 coverage，pre-commit 使用 lint-staged 只检查变更文件。另加 dependency audit/SBOM 的定期非阻断任务，确认后再逐步设为阻断门。
- 优先级：P1。

## F. 配置与安全

### F-1 当前 key 未发送到前端，但 BYOK 范围是服务器全局配置而非用户级

- 描述：key 仅由服务端 `process.env` 使用，`.env` 被 gitignore，状态 API 只回传 provider/configured；从静态检查未发现 key 写入 workspace 或 API response 的路径。这是正确的“服务器配置”模式，但不是多用户/每请求 BYOK：所有项目共用 `OPENROUTER_API_KEY`，也无法选 DeepSeek/OpenAI provider。
- 证据：[.gitignore:7]、[src/server/load-env.ts:6]、[src/server/llm-provider.ts:70]、[src/server/llm-provider.ts:103]、[src/server/index.ts:24]、[.env.example:7]。
- 建议：在开源文档明确“本地/自托管实例级 key”；如要实现用户 BYOK，设计短生命周期 server-side secret vault/reference，不持久化明文、不写日志、不回传浏览器，项目只保存 provider 配置引用。先完成 F-3 的出站 URL 限制。
- 优先级：P1。

### F-2 上传使用扩展名判断，缺少 MIME/魔数校验与失败清理

- 描述：profile/source 可上传条件只来自 `originalname` 的扩展名；没有 `fileFilter`、`mimetype` 或 PDF/DOCX 文件签名检查，攻击者可将任意内容伪装成允许类型。虽然后续 parser 可能拒绝，文件已落入 uploads。
- 证据：[src/server/index.ts:22]、[src/server/index.ts:65]、[src/server/document-parser.ts:79]、[src/server/document-parser.ts:55]。
- 建议：校验扩展名 + 声明 MIME + 文件魔数/容器结构，设置 file count/field size 限制，使用 quarantine 和 reject cleanup；为伪装扩展、ZIP bomb、损坏 PDF/DOCX、大小/数量超限添加测试。
- 优先级：P1。

### F-3 uploads 静态公开与 `cors()` 默认全开放不适合网络部署

- 描述：应用公开静态 `/uploads`，并允许任意 Origin；虽然 document content route 对 stored path 做了 project 归属和相对路径检查，但静态路径绕过该检查。无认证 MVP 在本机尚可，暴露端口或未来加入账号后会泄露研究文档。
- 证据：[src/server/index.ts:23]、[src/server/index.ts:30]、[src/server/index.ts:44]、[src/server/index.ts:65]。
- 建议：删除静态 uploads 暴露，仅通过授权后的 content route 读取；DTO 不返回 `storagePath`；CORS 用环境白名单并设定凭据策略。现有 `path.relative` 防穿越检查可保留并补 route 测试。
- 优先级：P0（只要部署到非 localhost）/ P1（严格本机 MVP）。

### F-4 可配置 base URL 未经出站目标校验，未来 BYOK 会放大为 SSRF

- 描述：`OPENROUTER_BASE_URL` 直接与 `/chat/completions` 拼接并 fetch。当前它仅来自服务器环境，外部用户不能直接提交该值，因此不是已证实的远程 SSRF；但若按需求开放“任意 OpenAI-compatible baseURL”，会允许访问内网/metadata 地址。
- 证据：[src/server/llm-provider.ts:56]、[src/server/llm-provider.ts:66]、[src/server/load-env.ts:11]。
- 建议：将 endpoint 设为受控 provider catalog；若确实允许自定义 endpoint，解析 URL 并只允许 HTTPS、DNS 解析后拒绝 loopback/private/link-local/metadata 网段，禁重定向，设连接/响应大小/超时上限并审计目标主机。
- 优先级：P1（实现自定义 baseURL 前）；P2（现状仅运维环境变量）。

## G. 依赖与构建

### G-1 当前未见已跟踪的 dist-server，但构建缺少清理与发布约束

- 描述：`dist/` 与 `dist-server/` 被忽略，Git 跟踪列表未发现构建产物，避免了将编译文件提交入仓库。另一方面 build 不清理旧输出，server `outDir` 固定为 `dist-server`；删除/重命名源文件后可能残留旧 JS，并且没有 CI 产物/部署脚本声明发布的唯一来源。
- 证据：[.gitignore:3]、[.gitignore:4]、[package.json:10]、[tsconfig.server.json:1]。
- 建议：保持构建产物不入库；加入跨平台 `clean`（安全地仅删除明确的 `dist`/`dist-server`）后再 build，并在 CI 从干净 checkout 构建、发布 artifact。部署使用 lockfile 的 `npm ci`，不使用工作目录中的旧 dist。
- 优先级：P2。

### G-2 依赖重复并不突出，但缺少可持续依赖治理

- 描述：清单中未见明显的同类 runtime 重复库；`pdfjs-dist` 与可选 `pdftotext` 是分层 fallback 而非 npm 重复。真正缺口是没有 lint/format 工具、许可证/SBOM、锁文件一致性/漏洞扫描门禁，因而无法持续判断“过时”或供应链风险。
- 证据：[package.json:16]、[src/server/document-parser.ts:92]、[package.json:27]、[package-lock.json:1]。
- 建议：保留 lockfile，并在 CI 定期运行受控的 `npm audit`、依赖更新检查和 SBOM 生成；将严重运行时漏洞设为告警到阻断的渐进策略。由于本次约束未进行联网漏洞数据库查询，本报告不对具体包版本作 CVE 结论。
- 优先级：P2。

## Top 5 最值得立即做的改进

1. **P0：替换 Store 的直接覆盖写入。** 先实现原子写、备份、加载失败不清空数据、schemaVersion/migration；这是保护用户研究资产的前提。
2. **P0/P1：关闭静态 uploads、收紧 CORS，并完成上传内容验证和清理。** 这决定应用能否从本机开发安全地走向开源自托管。
3. **P1：拆分 `index.ts` 并让 route 调用唯一的 search/export service。** 优先消除运行路径与已测试服务的分叉，再建立 `createApp()` 的 API 集成测试。
4. **P1：拆分 `App.tsx` 的 feature 边界。** 从 Workspace、Graph、Chat、Search 开始，保留共享 contracts 和 API client，降低任何 UX 改动的回归面。
5. **P1：建立可持续质量闭环。** 增加 parser/upload/Store/完整 evidence 管线测试、结构化日志与 job diagnostics，并把 typecheck/test/lint/format 放入 CI 和提交前检查。

## 审查结论与已验证项

项目适合继续作为单实例 MVP 演进，但尚未具备“多人自托管、可承受中断、可持续扩展 provider/格式”的工程保护层。应先处理存储、文件暴露和运行路径分叉，再加质量门禁，最后推进更复杂的 provider 与格式扩展。  
已执行且通过：`npm run typecheck`；`npm test`（9 个测试文件、55 项）。  
未执行：安装依赖、启动长期服务、修改业务代码、联网 CVE 查询。

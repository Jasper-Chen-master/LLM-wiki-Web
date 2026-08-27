# 任务：架构可扩展性 & 可持续质量保障审查（只读分析 + 报告写盘）

角色：资深软件架构师。对象：`E:\LLM wiki Web`（React/Vite 前端 + Express/TS 后端的 LLM Wiki 生成工具）。

## 背景
项目由 vibe coding 快速迭代而来，功能可用、准备开源（BYOK：用户自填 DeepSeek/OpenAI 兼容 API key）。本轮审查目标只有一个：**后期可扩展性** 与 **可优化检查性（可持续验证质量的能力）**，系统性弥补 vibe coding 留下的结构债。

## 严格约束
1. 除写入 `E:\LLM wiki Web\.ai-tmp\codex-report.md` 外，禁止修改/新建/删除任何文件。
2. 不装依赖、不启动长驻服务；可跑只读检查（tsc --noEmit、npm test、读文件）。
3. 报告用中文。

## 审查维度（每条问题必须给出：描述 + 证据[文件:行号] + 建议 + 优先级 P0/P1/P2）
A. 架构分层与模块边界：前后端职责清晰度、上帝文件（>500 行组件/service）、共享类型契约(src/shared/contracts.ts)的实际使用一致性。
B. 可扩展性演练：假想三个变更——(1) 新增一个 LLM provider；(2) 新增一种文档格式(如 .docx)；(3) 新增一种导出格式。逐个评估现有代码中要改几处、硬编码集中在哪(llm-provider.ts / document-parser.ts / export-service.ts / prompts/)。
C. 数据层健壮性：data/workspace.json 单文件存储的并发写、崩溃恢复、schema 版本迁移、上传文件管理(uploads/)。
D. 错误处理与可观测性：route 层 try/catch 覆盖、LLM 输出 JSON 解析失败兜底、是否有结构化日志、前端错误提示链路。
E. 测试与质量门禁：列出 vitest 现有 *.test.ts 清单及覆盖层；指出缺失的关键测试(生成管线、evidence 引用校验)；建议 lint/format/typecheck 门禁方案(git hooks or CI)。
F. 配置与安全：.env 加载链路(load-env.ts)、BYOK key 是否会被存储/泄露、上传接口路径穿越与 MIME 校验、SSRF(LLM baseURL) 风险。
G. 依赖与构建：依赖重复/过时、dist-server 提交进仓库的问题、构建产物策略。

## 输出
完整报告写入 `E:\LLM wiki Web\.ai-tmp\codex-report.md`：
# Codex 独立审查报告 → ## 总览(≤10行) → ## A~G 各节 → ## Top 5 最值得立即做的改进。
全部写完后仅在 stdout 打印一行：REPORT_DONE

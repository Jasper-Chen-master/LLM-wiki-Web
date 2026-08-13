# Architecture

The MVP is a local TypeScript web application: React/Vite renders the workspace and Express exposes a small API. A filesystem-backed repository persists projects, parsed blocks, knowledge graph data, and job state so the project can run without an external database.

```text
React UI → Express API → Application services → filesystem repository
                              ├─ document parsing (PDF/DOCX)
                              ├─ LLM provider abstraction (DeepSeek / demo fallback)
                              └─ graph, evidence, search, export services
```

Contracts in `src/shared/contracts.ts` are the single source of truth for API and UI. Processing is asynchronous from the HTTP caller's perspective: confirmation creates a job which advances through parsing, filtering, extraction, resolution, and graph construction. The MVP runs it in-process; a future queue can consume the same job contract.

The graph stores only goal-conditioned, evidence-bound knowledge. Raw document blocks remain separate and every node/edge links to `Evidence` records.

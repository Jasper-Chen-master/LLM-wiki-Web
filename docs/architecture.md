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

## Goal-conditioned Wiki planning

Wiki construction uses a staged planning pipeline rather than asking one extraction prompt to invent entity types:

```text
Validated Research Profile
        +
Distributed samples from every current source document
        ↓
Corpus analysis (themes, goal alignment, required knowledge)
        ↓
Validated WikiGenerationPlan (controlled categories and relation rules)
        ↓
Block-level relevance evaluation
        ↓
Plan-constrained entity and relation extraction
        ↓
Global AI classification review across extracted entities
        ↓
Deterministic category validation + evidence-bound graph construction
```

`Project.generationPlan` persists the plan used by the current build, including analyzed document IDs. `WikiProfile.entityTypes` is the authoritative top-level ontology: every user-declared type is retained with its label and precedes corpus suggestions. Corpus analysis may add only missing broad semantic roles; generated categories are canonicalized and deduplicated by role. Themes, chapter titles, named concepts, equations, and methods remain entities, never category labels. For example, `波`, `向心加速度`, `波动方程`, and `量纲分析` are classified under broad concept, quantity, formula, and method categories instead of becoming four graph filters.

After evidence extraction, a separate bounded AI pass classifies entities globally from their names, summaries, and properties so extraction batches cannot silently create inconsistent types. Provider-written entity types are never persisted directly: they are mapped back to labels in the validated plan. Unambiguous semantic names provide an additional general guardrail for laws/rules, theorems, theories, models, methods/algorithms, equations/formulas, experiments/tests, quantities, and phenomena/effects. Newton's laws are one regression example, not a domain-specific special case. Ambiguous terms remain subject to contextual AI classification.

Corpus planning uses distributed, bounded samples from every document. Relevance evaluation and extraction still process all new blocks in bounded batches. This gives the plan corpus coverage without placing an entire large collection in one prompt.

## Wiki chat

Project chat is a retrieval and reasoning layer over the structured Wiki, not a second document-ingestion path. For every message, the provider first analyzes the question against one bounded catalog of Wiki node names, aliases, types, and summaries, then selects conceptually relevant node IDs. The server builds a fresh, project-scoped reasoning context from those `WikiNode`s, `WikiEdge`s, node properties, and safe `Evidence` locations for the answer step. This lets one conversation flow explain and connect Wiki concepts instead of requiring literal wording in the question. It never sends `DocumentBlock.text` or `Evidence.originalText` to the chat provider.

The provider returns only node and evidence IDs. The server validates those IDs against the current retrieval context, then resolves citations to the persisted document name, page, section, and block ID. A completed processing job increments `Project.wikiRevision`; the next chat request reads the current Wiki snapshot automatically, so newly parsed documents are available without rebuilding a separate chat database.

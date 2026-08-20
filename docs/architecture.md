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
Global AI classification proposals across canonical entities
        ↓
Risk detector (identity evidence, contradiction, confidence)
        ↓
Selective independent classification review
        ↓
Deterministic validation + quality gate + evidence-bound graph publication
```

The Research Profile may select a preset (`course`, `research`, `literature_review`,
`experimental`, `prediction`, `business`, `policy`, `technical`, `personal`, or
`general`), request automatic mode detection, or provide fully custom requirements.
Preset values are starting constraints rather than fixed ontologies. The planner combines
the selected mode, target questions, analysis unit, custom instructions, quality preference,
and distributed corpus evidence to create the smallest sufficient plan for that project.

Generation plans use the compatible v2 contract. In addition to categories they contain
field rules, a semantic relation whitelist, source/target category constraints, condition and
inference policies, and quality thresholds. This allows a course Wiki to preserve derivations,
an experimental Wiki to preserve sample/condition boundaries, a policy Wiki to preserve scope
and versions, and a technical Wiki to preserve interfaces and dependencies without branching
the processing pipeline into domain-specific implementations.

`Project.generationPlan` persists the plan used by the current build, including analyzed document IDs. `WikiProfile.entityTypes` is the authoritative top-level ontology. When it is non-empty, the plan enters `entityTypePolicy: strict`: the categories must exactly match the user's comma-separated labels, in order, with no corpus additions, removals, translation, or role-based expansion. When it is empty, `entityTypePolicy: open` permits corpus-driven broad semantic roles. Themes, chapter titles, named concepts, equations, and methods remain entities, never category labels. For example, `波`, `向心加速度`, `波动方程`, and `量纲分析` are classified under the user's supplied labels (or, only when no labels were supplied, inferred broad roles) instead of becoming additional graph filters.

Built-in blueprint presets are editable project-scoped defaults. Saving a non-custom profile stores its current fields under `Project.presetProfiles[preset][language]`; selecting that preset later prefers the saved override and falls back to the shipped template only when no override exists. Language variants are stored independently, so editing a Chinese preset does not overwrite its English counterpart.

After evidence extraction, a separate bounded AI pass proposes classifications globally from
source passages, page and section context, summaries, structured properties, relations to other
entities, corpus themes, the research goal, and controlled category definitions. Canonical names
and extraction-written types are supplied only as weak signals. Each proposal must first explain
what the entity is and how it functions, list the concrete decision factors and counter-evidence,
then return a semantic role, controlled category ID, confidence, alternatives, ambiguity flag,
and claimed identity excerpt. The server verifies that excerpt against the supplied source text
before it can influence a high-specificity class.

Provider-written types are proposals, never final values. Named laws, theorems, and theories need
positive identity evidence. A relationship, equality, proportionality, rate-of-change statement,
or important result is not promoted to a law merely because its content resembles a stable rule.
Name-context conflicts, low-confidence, or explicitly ambiguous proposals enter a second independent review;
unambiguous nodes avoid that extra call. The deterministic resolver then accepts, corrects, or
marks the result for review and records that decision on the node. This is domain-independent: the
same guard applies to course formulas, experimental relationships, business metrics, policy
dependencies, and technical system behavior.

A name pattern never produces an accepted classification by itself. If AI classification is
unavailable, lexical or property-based fallbacks remain provisional and are marked for review.
After independent review, a well-supported contextual conclusion may override a misleading name.
Deterministic rules enforce evidence and schema boundaries; they do not substitute for semantic
understanding.

Corpus planning uses distributed, bounded samples from every document. Relevance evaluation and extraction still process all new blocks, but batches are filled by a text budget with a maximum item count instead of a fixed page count. Short lecture-slide pages can therefore share a prompt while long paper pages remain bounded. Independent batches run through a small configurable concurrency pool; results are restored to source order before graph construction. Every batch retains the same schema validation, safe fallback, evidence-ID checks, and deterministic category validation, so throughput does not weaken extraction quality.

Structured provider requests use the provider's JSON response mode and task-specific output limits. Invalid or truncated output is still validated and repaired through the existing bounded retry path.

## Job performance and recovery

Only one processing worker may run for a project at a time. Simultaneous confirmation requests receive the already-running job rather than creating duplicate LLM pipelines. The UI also disables rebuild submission while that job is active.

The browser polls a lightweight latest-job endpoint while processing and reloads the full project snapshot only when the job reaches a terminal state. Waiting progress is persisted less frequently than stage transitions, avoiding repeated serialization of the graph and evidence payload.

Long AI stages expose real sub-stage batch progress through `ProcessingJob.batchProgress`: corpus analysis, plan generation, relevance filtering, knowledge extraction, and entity classification each report completed/total batches plus an updating elapsed time. The top-level percentage is derived from completed batches rather than wall-clock interpolation, so a slow provider response remains visibly alive without falsely claiming work was completed. The UI localizes these structured fields instead of parsing server message text.

Transport failures and structured-output failures have separate retry boundaries. DeepSeek owns bounded retry for timeouts, rate limits, and temporary server failures; `generateStructured` retries only when a received response fails JSON/schema validation. A network failure therefore cannot accidentally multiply the full transport retry sequence through the schema-repair loop. Global entity classification considers every extracted canonical entity, but duplicate mentions are classified once. Only risky proposals use the second review call, and the final decision is applied back to all mentions before graph resolution.

Jobs remain in-process for the MVP. On server startup, any non-terminal persisted job is marked failed with an interruption explanation so it cannot masquerade indefinitely as a live worker. Parsed documents and completed graph data remain available for a safe retry. A future durable queue can replace this recovery rule without changing the `ProcessingJob` contract.

An unchanged validated Research Profile preserves the existing `WikiGenerationPlan`. New or changed profile data invalidates the plan, while newly added source documents still cause corpus-aware planning before extraction. This keeps user preference understanding and automatic Wiki structure design authoritative without paying the planning cost for a no-op rebuild.
Changing the preset or custom requirements marks the project for a full knowledge rebuild. The job reuses persisted parsed blocks, prepares the replacement graph, and clears the old derived graph only after successful extraction so a provider failure does not erase the last usable Wiki.

## Semantic graph validation

Co-occurrence is retrieval metadata and is not materialized as a directed semantic edge. An
extracted relation is persisted only when its label is in the current plan, its endpoint types
match the relation rule, its evidence resolves inside the project, its inference status is
allowed, required conditions are present, and any provider confidence clears the active policy.

Completed builds preserve evidence, classification decisions, and relation-validation results,
but do not receive a single aggregate quality score. Planned requirements can depend on
cross-node reasoning, so their apparent keyword coverage is not treated as a publish gate.
Corrected and unresolved decisions stay visible in the node detail panel, so safe fallback does
not become a silent semantic change.

This pipeline adapts the useful maintenance ideas from `nashsu/llm_wiki` to a structured,
evidence-first graph: Research Profile acts as purpose, `WikiGenerationPlan` acts as schema,
analysis precedes generation and unchanged parsed sources are reused. Unlike a free-form Markdown
maintainer, all model outputs still cross typed schemas, project boundaries, evidence checks, and
relation rules.

Quality and cost preferences also tune processing rather than changing validation guarantees.
Economy mode uses broader batches and shallower corpus sampling, while maximum-quality mode uses
more distributed samples, longer per-block context, smaller batches, and lower concurrency.

## Wiki chat

Project chat is a retrieval and reasoning layer over the structured Wiki, not a second document-ingestion path. For every message, the provider first analyzes the question against one bounded catalog of Wiki node names, aliases, types, and summaries, then selects conceptually relevant node IDs. The server builds a fresh, project-scoped reasoning context from those `WikiNode`s, `WikiEdge`s, node properties, and safe `Evidence` locations for the answer step. This lets one conversation flow explain and connect Wiki concepts instead of requiring literal wording in the question. It never sends `DocumentBlock.text` or `Evidence.originalText` to the chat provider.

The provider returns only node and evidence IDs. The server validates those IDs against the current retrieval context, then resolves citations to the persisted document name, page, section, and block ID. A completed processing job increments `Project.wikiRevision`; the next chat request reads the current Wiki snapshot automatically, so newly parsed documents are available without rebuilding a separate chat database.

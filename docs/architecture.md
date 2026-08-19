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

## Reproducible build inputs

Every successful build publishes a `BuildManifest` containing the normalized Research Profile
hash, ordered source content hashes, parser/chunking versions, prompt versions, schema version,
provider/model settings, temperature, frozen ontology revision, and a normalized frozen-plan
fingerprint. The manifest's
`inputFingerprint` excludes run-specific timestamps and job IDs, so equivalent inputs can be
compared across runs while each execution still has its own audit record.

Source parsing uses deterministic semantic-boundary chunks rather than truncating page text at
prompt time. Chunks are capped at 1,200 characters with a fixed 160-character overlap and receive
content-derived IDs scoped to the persisted document record. Evidence IDs are derived from the
project, stable block ID, and evidence status. Existing documents with an older chunking version
are reparsed safely; their last usable blocks and graph remain until the replacement parse succeeds.

## Goal-conditioned Wiki planning

Wiki construction uses a staged planning pipeline rather than asking one extraction prompt to invent entity types:

```text
Validated Research Profile
        +
All ordered blocks from every current source document
        ↓
Per-document analysis slices with rolling same-document context
        ↓
Validated DocumentKnowledgeAnalysis (scope, key points, contradictions, coverage, evidence IDs)
        ↓
Validated WikiGenerationPlan (controlled categories and relation rules)
        ↓
Block-level relevance evaluation
        ↓
Per-block Evidence Claim ledger with mandatory coverage (`claimed` / `no_goal_relevant_claim` / `unresolved`)
        ↓
Global AI Candidate Catalog (every non-ignored claim has exactly one semantic destination)
        ↓
Candidate eligibility and Concept Registry semantic consolidation
        ↓
Stable Wiki summarization from each canonical concept's complete evidence set
        ↓
Deterministic publication gate + evidence-bound graph publication
```

The Research Profile presents four modes: smart auto-detect, academic papers, course learning,
and custom. The first three are editable starting constraints; custom requirements are
authoritative. The planner combines the selected mode, target questions, analysis unit, custom
instructions, quality preference, and persisted document analyses to create the smallest
sufficient plan for that project. Legacy stored preset values remain readable and are treated as
custom unless the user selects one of the current modes.

Generation plans use the compatible v2 contract. In addition to categories they contain
field rules, a semantic relation whitelist, source/target category constraints, condition and
inference policies, and quality thresholds. This allows a course Wiki to preserve derivations,
an experimental Wiki to preserve sample/condition boundaries, a policy Wiki to preserve scope
and versions, and a technical Wiki to preserve interfaces and dependencies without branching
the processing pipeline into domain-specific implementations.

`Project.generationPlan` persists the plan used by the current build, including analyzed document IDs. `WikiProfile.entityTypes` is the authoritative top-level ontology: every user-declared type is retained with its label and precedes document-derived suggestions. Document analysis may suggest only missing broad semantic roles; generated categories are canonicalized and deduplicated by role. Themes, chapter titles, named concepts, equations, and methods remain entities, never category labels. For example, `波`, `向心加速度`, `波动方程`, and `量纲分析` are classified under broad concept, quantity, formula, and method categories instead of becoming four graph filters.

`DocumentKnowledgeAnalysis` is the persisted intermediate layer between raw blocks and the Wiki
plan. Long documents are split by text budget and analyzed in source order; every later slice
receives a compact digest of earlier slices from that same document. A final synthesis combines
validated slice outputs without receiving raw text again. Server materialization accepts only
block IDs from that document, accepts synthesis citations only when a slice already supplied
them, validates Concept Registry IDs within the current project, and marks missing or failed
coverage as `unresolved`. Suggested Wiki topics remain design proposals, never source facts.

The first validated plan for a profile is frozen as an ontology revision before extraction. Adding
documents does not replace that plan or reclassify existing nodes against a newly invented
taxonomy. New sources are analyzed separately; genuinely missing categories, field rules, or
relation rules are persisted as `OntologyExtensionProposal` records for explicit future review.
Changing the approved Research Profile remains the intentional path that creates a new ontology
revision and rebuilds project knowledge.

Early extraction no longer creates free-form `KnowledgeCandidate` objects. It first writes an
`EvidenceClaim` ledger: each relevant document block receives exactly one coverage outcome—
`claimed`, `no_goal_relevant_claim`, or `unresolved`—and any claim is atomic, directly supported,
and linked to its originating block. An omitted model decision becomes an explicit `unresolved`
record; it can never silently vanish as irrelevant evidence. `EvidenceClaimCoverage` records make
the coverage boundary auditable independently from the eventual graph.

The frozen `CandidateExtractionContract` in `WikiGenerationPlan` defines the analysis unit,
atomicity rules, attachment-vs-creation rules, exclusions, and required kinds of knowledge before
any source extraction starts. Examples, conditions, notation, derivation steps, repeated wording,
and scoped applications are preserved as claims but normally attach to a broader candidate unless
the user's analysis unit requires independent treatment.

The global AI `Candidate Catalog` receives all non-ignored claims and must assign every claim ID
exactly once to a canonical preliminary candidate, with an explicit semantic action. This is where
the model decides whether claims are the same, aliases, instances, facets, specializations, or
independent knowledge. Server code validates coverage, IDs, evidence, and controlled categories;
it does not use lexical similarity or an embedding threshold to make that semantic decision.

Only after cataloging does the system create `KnowledgeCandidate` objects and apply the
deterministic publication policy. This policy therefore controls evidence and display eligibility,
not semantic identity.

A deterministic, versioned `NodeCreationPolicy` scores user relevance, evidence strength,
conceptual independence, and structured completeness. Only `publish_node` candidates enter the
main graph; `review` and `ignore` decisions remain persisted with their evidence block IDs and
score breakdown, so structural stability does not erase model-understood information. On
incremental builds, prior candidates participate in reevaluation, allowing independent source
support to accumulate without asking the model to rediscover the same candidate every time.

A separate Wiki Summarizer runs after Concept Registry materialization. It writes node prose from
the canonical concept's complete evidence set and semantic members rather than from the first
local extraction. When candidate membership, claim membership, and evidence membership are
unchanged, the previous accepted summary is reused instead of being regenerated.

Candidate eligibility and semantic identity are separate decisions. Every non-ignored candidate
enters a dedicated AI consolidation pass with its evidence excerpts, the frozen ontology, the
Research Profile, the project unit of analysis, and the existing `ConceptRegistry`. The model—not
name similarity or an embedding threshold—decides whether candidates are equivalent, aliases,
instances, facets, specializations, or genuinely independent concepts. Thus a general concept
such as `路径无关性` can become one canonical page while `重力做功与路径无关` and
`弹簧力做功与路径无关` remain visible as scoped semantic members with their own evidence.

The server does not overrule semantic meaning with a second heuristic deduplicator. Its role is to
validate that candidate IDs exist in the current project, every candidate is covered exactly once,
the canonical type belongs to the frozen ontology, evidence IDs are valid, and an existing registry
ID really belongs to this project. Low-confidence, incomplete, malformed, or unavailable AI output
fails non-destructively: affected candidates remain separate. Accepted groups are persisted as
`SemanticResolution` audit records and materialized into stable `ConceptRegistryEntry` identities.
Graph node IDs use those registry identities; all member evidence, scope, conditions, aliases, and
resolution reasons remain available instead of being deleted by consolidation.

Candidate Catalog types are proposals, never a license to invent classes. The server accepts only
labels from the frozen ontology. Named laws, theorems, theories, models, methods, formulas,
experiments, and phenomena must still be directly supported by the claim evidence and retain their
scope. A relationship, equality, rate, or important result is not promoted to a named law merely
because it looks stable. The same contextual guard applies to course formulas, experimental
relationships, business metrics, policy dependencies, and technical system behavior.

A name pattern never determines a catalog assignment by itself. AI receives the claim statement,
source block, scope, properties, analysis unit, and contract. Deterministic rules enforce schema,
coverage, and provenance boundaries; they do not substitute for semantic understanding.

Document analysis covers every parsed block rather than a representative sample. Text-budget
batches bound long documents, while ordered per-document processing preserves rolling context;
different documents may still use a small configurable concurrency pool. Relevance evaluation
and Evidence Claim extraction then process all target blocks. Every stage retains schema
validation, safe fallback, evidence-ID checks, and deterministic coverage.

Structured provider requests use the provider's JSON response mode and task-specific output limits. Invalid or truncated output is still validated and repaired through the existing bounded retry path.

## Job performance and recovery

Only one processing worker may run for a project at a time. Simultaneous confirmation requests receive the already-running job rather than creating duplicate LLM pipelines. The UI also disables rebuild submission while that job is active.

The browser polls a lightweight latest-job endpoint while processing and reloads the full project snapshot only when the job reaches a terminal state. Waiting progress is persisted less frequently than stage transitions, avoiding repeated serialization of the graph and evidence payload.

Long AI stages expose real sub-stage batch progress through `ProcessingJob.batchProgress`: document analysis, document synthesis, plan generation, relevance filtering, evidence-claim extraction, global candidate cataloging, semantic consolidation, and Wiki summarization each report completed/total batches plus an updating elapsed time. The top-level percentage is derived from completed batches rather than wall-clock interpolation, so a slow provider response remains visibly alive without falsely claiming work was completed. The UI localizes these structured fields instead of parsing server message text.

Transport failures and structured-output failures have separate retry boundaries. DeepSeek owns bounded retry for timeouts, rate limits, and temporary server failures; `generateStructured` retries only when a received response fails JSON/schema validation. A network failure therefore cannot accidentally multiply the full transport retry sequence through the schema-repair loop.

Jobs remain in-process for the MVP. On server startup, any non-terminal persisted job is marked failed with an interruption explanation so it cannot masquerade indefinitely as a live worker. Parsed documents and completed graph data remain available for a safe retry. A future durable queue can replace this recovery rule without changing the `ProcessingJob` contract.

An unchanged validated Research Profile preserves the existing `WikiGenerationPlan`. New or changed profile data invalidates the plan, while newly added source documents receive full document analysis before an extension plan is proposed. This keeps user preference understanding and automatic Wiki structure design authoritative without paying the planning cost for a no-op rebuild.
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

This pipeline adapts the useful two-stage method from `nashsu/llm_wiki` to a structured,
evidence-first graph: Research Profile acts as purpose, persisted `DocumentKnowledgeAnalysis`
performs document-wide identification and integration, and `WikiGenerationPlan` governs later
generation. Unlike a free-form Markdown maintainer, raw blocks remain the provenance authority;
all model outputs still cross typed schemas, project boundaries, block-ID checks, coverage checks,
and relation rules.

Quality and cost preferences also tune processing rather than changing validation guarantees.
Economy mode uses broader document-analysis batches, while maximum-quality mode uses smaller
batches and lower concurrency. Both modes cover every parsed block; cost preferences never turn
sampling into silent omission.

## Wiki chat

Project chat is a retrieval and reasoning layer over the structured Wiki, not a second document-ingestion path. For every message, the provider first analyzes the question against one bounded catalog of Wiki node names, aliases, types, and summaries, then selects conceptually relevant node IDs. The server builds a fresh, project-scoped reasoning context from those `WikiNode`s, `WikiEdge`s, node properties, and safe `Evidence` locations for the answer step. This lets one conversation flow explain and connect Wiki concepts instead of requiring literal wording in the question. It never sends `DocumentBlock.text` or `Evidence.originalText` to the chat provider.

The provider returns only node and evidence IDs. The server validates those IDs against the current retrieval context, then resolves citations to the persisted document name, page, section, and block ID. A completed processing job increments `Project.wikiRevision`; the next chat request reads the current Wiki snapshot automatically, so newly parsed documents are available without rebuilding a separate chat database.

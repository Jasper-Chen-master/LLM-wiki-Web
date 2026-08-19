# Decisions

## 2026-08-19 — Persist full-document analysis before Wiki planning

The representative-sample corpus planner is replaced by a persisted
`DocumentKnowledgeAnalysis` stage adapted from the analysis-before-generation design in
`nashsu/llm_wiki`. Every parsed block enters an ordered, text-budgeted analysis slice. Later
slices receive a compact digest of earlier slices from the same document, and a separate synthesis
turn integrates themes, entities, findings, relationships, contradictions, and possible Wiki
topics without receiving the raw document again.

The model output is a proposal, not provenance. Server materialization removes foreign or
fabricated block IDs, rejects cross-project Concept Registry IDs, requires every stored knowledge
point to retain at least one valid evidence block, and converts omitted or failed coverage to
`unresolved`. A synthesis may cite only evidence IDs already emitted by a validated slice.
Document-level suggestions inform `WikiGenerationPlan`; source facts still enter the graph only
through the later Evidence Claim ledger and its independent validation.

This decision supersedes the representative-sampling and legacy free-form
`extractKnowledge → classification → classification_review` implementation. Those dead provider
methods, schemas, prompt versions, UI phases, and tests were removed. Deterministic classification
and graph-validation utilities that still protect active consumers remain in place.

## 2026-08-19 — Constrain candidate creation with a claim ledger and global catalog

Candidate variability begins before entity resolution: a free-form per-block entity extractor can
notice, omit, over-split, or summarize the same source passage differently on separate runs. The
pipeline therefore records atomic `EvidenceClaim` objects before creating candidates. Every relevant
block must receive an auditable coverage outcome; omitted model decisions become `unresolved`, not
silent absence. The frozen `CandidateExtractionContract` defines the analysis unit, atomicity,
attachment, and exclusion rules for that build.

Only a dedicated global AI Candidate Catalog can turn claims into candidates. It must assign every
non-ignored claim exactly once and classify its semantic destination as equivalent, instance,
facet, specialization, independent, or uncertain. The server validates IDs, coverage, evidence,
and ontology labels but does not substitute a lexical or similarity heuristic for that semantic
decision. Final summaries are generated after Concept Registry materialization and are reused when
their claim/evidence membership has not changed.

## 2026-08-19 — Let AI own semantic consolidation; let code own safety

Semantic overlap is resolved in a dedicated global AI pass after evidence-backed candidates have
been created and before node publication. The resolver receives the Research Profile, unit of
analysis, frozen ontology, candidate evidence, and existing project Concept Registry. It may mark
members as `same_as`, `alias_of`, `instance_of`, `facet_of`, `specialization_of`,
`keep_separate`, or `uncertain`. No lexical-similarity, embedding-distance, or fixed ontology rule
is allowed to make those semantic merge decisions.

The server remains authoritative only for trust boundaries: schema validity, current-project IDs,
complete single assignment, controlled category labels, evidence preservation, confidence safety,
and stable registry identity. Invalid, missing, low-confidence, or uncertain proposals preserve
candidates separately. A merge is therefore an evidence-preserving canonical view, not destructive
deletion. `KnowledgeCandidate`, `SemanticResolution`, and `ConceptRegistryEntry` remain separate
records so a future model or human reviewer can reconstruct and revise the decision.

## 2026-08-19 — Make build inputs reproducible and auditable

Each build records a content-addressed manifest with source hashes, normalized profile hash,
parser and chunking versions, prompt/schema versions, ontology revision, provider/model, and
temperature. Parser output is deterministically chunked before any LLM stage, and block/evidence
identifiers no longer depend on fresh random UUIDs. Prompt batching consumes complete chunks
instead of silently slicing off the tail of long pages.

## 2026-08-19 — Freeze ontology revisions and queue extensions

The first validated generation plan for an approved profile becomes a frozen ontology revision.
New documents are processed against that revision; an independently generated comparison plan may
only create an `OntologyExtensionProposal` and cannot mutate active categories, fields, relations,
or existing node classifications. A changed Research Profile intentionally creates the next
ontology revision. This preserves adaptive initial understanding while preventing incremental
uploads from silently redesigning the Wiki.

## 2026-08-19 — Separate knowledge candidates from published nodes

LLM extraction now proposes evidence-backed knowledge candidates. A versioned server-side policy
uses a mixed score—semantic user relevance plus deterministic evidence, reuse, independence, and
structured-completeness signals—to decide `publish_node`, `review`, or `ignore`. Every decision is
persisted; non-published candidates are not deleted. Incremental builds merge prior candidates
before reevaluation, so accumulated evidence can promote a candidate without sacrificing the
stable main graph or the system's ability to understand rare content.

## 2026-08-13 — Local vertical slice first

Use a filesystem repository and in-process job runner for the MVP. This makes the complete workflow runnable with no database or cloud account while preserving repository and job interfaces for a later migration.

## 2026-08-13 — Optional DeepSeek, never an implicit dependency

DeepSeek is accessed only through `LLMProvider`. Missing configuration activates a clearly marked deterministic demo provider; it does not claim model-derived facts. Production use should set `DEEPSEEK_API_KEY` and replace/demo-check extraction quality.

## 2026-08-17 — Analyze the corpus before defining Wiki categories (superseded on 2026-08-19)

Entity types are no longer free-form extraction output. Each build first analyzes distributed samples from every current source together with the approved Research Profile, then creates and validates a persisted `WikiGenerationPlan`. Relevance filtering and extraction receive this plan. A separate global AI classification pass reviews all extracted entities against the same controlled categories, after which a deterministic post-validator maps all provider output back to plan labels.

This staged design costs additional model calls, but it improves classification consistency, makes the active ontology auditable, and prevents obvious semantic drift. Deterministic guardrails validate evidence and controlled categories, while semantic identity is decided from contextual AI analysis. Named examples such as Newton's laws are regression fixtures, not a name-only taxonomy. If final plan generation fails validation, the system conservatively combines categories from the successful corpus analyses rather than reverting to unrestricted types.

## 2026-08-17 — User knowledge types outrank corpus themes

`WikiProfile.entityTypes` defines the required top-level Wiki structure. Corpus analysis can discover missing reusable semantic roles, but cannot promote a chapter topic, individual entity, named equation, or method into a graph category. AI category suggestions are canonicalized to broad role labels and deduplicated against user types. This prevents narrow filters such as `波`, `波动方程`, or `量纲分析` from replacing user-requested classes such as `概念`, `公式`, and `方法`.

## 2026-08-18 — Optimize throughput without weakening goal-conditioned generation

Research Profile understanding, full-document analysis, and AI-generated `WikiGenerationPlan` remain mandatory quality gates. Text-budget batching fills prompts efficiently across both short slides and long papers; slices stay ordered inside each document while separate documents use bounded concurrency. Structured calls request JSON output but still pass through local Zod validation, repair retries, evidence binding, and deterministic category enforcement.

One project can have only one active in-process build. Unchanged profiles retain their validated plan; changed profiles invalidate it, and new documents still trigger corpus-aware planning. Job polling uses a lightweight status response, while full snapshots reload at completion. Persisted non-terminal jobs are marked interrupted after a restart because the MVP has no durable worker queue; this is safer than presenting a stale job as still running.

## 2026-08-18 — Report completed work and isolate retry domains

Progress percentages are based on completed LLM batches, with a separate heartbeat elapsed time for the currently active sub-stage. Time alone must not advance the percentage because it makes a job appear almost complete while one slow request is still outstanding. `ProcessingJob.batchProgress` is an optional shared contract so old persisted jobs remain readable.

Provider transport retry and structured-output repair are deliberately independent. Network failures propagate after the provider's bounded retry policy; only a response that was actually received but fails local JSON/Zod validation enters the repair prompt. This removes multiplicative waits while retaining schema validation and repair quality. Entity classification remains a global validation pass, but canonical duplicates are collapsed before that pass to avoid paying repeatedly for the same classification decision.

## 2026-08-18 — Use adaptive task contracts instead of a universal course ontology

Wiki generation is driven by an editable Research Profile plus corpus evidence. The UI exposes
only smart auto-detect, academic papers, course learning, and custom modes; they are starting
constraints, not separate pipelines. `WikiGenerationPlan` v2 carries the detected mode, analysis
unit, target questions, field rules, relation rules, and quality policy while remaining
read-compatible with persisted v1 plans.

User-declared categories remain authoritative. When users choose automatic or custom generation
without declaring categories, the planner may keep reusable corpus-derived domain classes using
the generic semantic role. This is necessary for legitimate classes such as clause, component,
company, claim, sample, and feature that do not belong to a course-centric ontology.

## 2026-08-18 — Co-occurrence is not a semantic graph relation

The graph builder no longer creates `related_to` edges merely because entities share an evidence
block. Such pairs overwhelmed real relations and gave directed semantics to unordered
co-occurrence. Formal edges now pass the plan's relation whitelist, endpoint-category constraints,
condition requirements, inference policy, confidence threshold, and evidence validation.

Each completed revision receives a deterministic quality report. Quality warnings remain visible
without silently deleting supported knowledge. This creates the validation boundary required for
selective repair and regression comparison in later iterations.

## 2026-08-18 — Classification is a reviewed decision, not a model label (legacy path removed on 2026-08-19)

The global classifier now returns an auditable proposal containing a controlled category,
semantic role, confidence, alternatives, ambiguity state, and a short source identity excerpt.
The server verifies that the excerpt occurs in the supplied evidence. Named laws, theorems, and
theories require positive identity evidence; importance, mathematical equality, or rate-of-change
structure is insufficient. Therefore a generic “X 与 Y 变化率关系” cannot become a law merely
because the model assigns that label. It safely falls back to formula or concept and records the
correction.

Only contradictory, low-confidence, or ambiguous proposals receive a second independent LLM
review. This follows the analyze-then-generate and asynchronous-review ideas demonstrated by
`nashsu/llm_wiki` without copying its free-form file model. Canonical deduplication occurs before
classification, so the additional quality check is selective rather than a full second pass.

`WikiNode.classification` persists the final decision. The UI shows each node's decision status
and rationale, making automatic correction and remaining uncertainty observable without turning
the Wiki into a single aggregate score.

## 2026-08-18 — Entity names are hints, not classification authority

Classification now receives the entity's cited passages, page and section locations, summary,
properties, extracted relation neighborhood, corpus themes, controlled category definitions, and
research goal. The model must produce a semantic explanation, concrete decision factors, and
counter-evidence before selecting a category. Extraction-written types and entity names are weak
signals because either may be generated incorrectly.

A name-derived category is never accepted without contextual AI support. A conflict between the
name and the semantic proposal triggers the independent review pass. A high-confidence reviewed
conclusion may override a misleading name, while named laws, theorems, and theories still require
a source excerpt that explicitly establishes that identity. If AI classification is unavailable,
surface-based fallbacks remain marked for review rather than being presented as verified facts.

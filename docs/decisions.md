# Decisions

## 2026-08-13 — Local vertical slice first

Use a filesystem repository and in-process job runner for the MVP. This makes the complete workflow runnable with no database or cloud account while preserving repository and job interfaces for a later migration.

## 2026-08-13 — Optional DeepSeek, never an implicit dependency

DeepSeek is accessed only through `LLMProvider`. Missing configuration activates a clearly marked deterministic demo provider; it does not claim model-derived facts. Production use should set `DEEPSEEK_API_KEY` and replace/demo-check extraction quality.

## 2026-08-17 — Analyze the corpus before defining Wiki categories

Entity types are no longer free-form extraction output. Each build first analyzes distributed samples from every current source together with the approved Research Profile, then creates and validates a persisted `WikiGenerationPlan`. Relevance filtering and extraction receive this plan. Each canonical node is first understood from its full evidence context, then one controlled AI classification pass maps that understanding to a permitted plan category; malformed responses fall back to the extracted controlled label.

This staged design keeps planning and extraction evidence-aware without adding a second classification/review loop. Structured-output and controlled-category checks remain deterministic guardrails; the model must read and reconstruct the complete node context before selecting a label. Named examples such as Newton's laws are regression fixtures, not a name-only taxonomy. If final plan generation fails validation, the system conservatively combines categories from the successful corpus analyses rather than reverting to unrestricted types.

## 2026-08-17 — User knowledge types outrank corpus themes

`WikiProfile.entityTypes` defines the required top-level Wiki structure. Corpus analysis can discover missing reusable semantic roles, but cannot promote a chapter topic, individual entity, named equation, or method into a graph category. AI category suggestions are canonicalized to broad role labels and deduplicated against user types. This prevents narrow filters such as `波`, `波动方程`, or `量纲分析` from replacing user-requested classes such as `概念`, `公式`, and `方法`.

## 2026-08-18 — Optimize throughput without weakening goal-conditioned generation

Research Profile understanding, distributed corpus analysis, and AI-generated `WikiGenerationPlan` remain mandatory quality gates. Performance improvements target redundant work after those gates: text-budget batching fills prompts efficiently across both short slides and long paper pages, and independent LLM batches use bounded concurrency. Structured calls request JSON output but still pass through local Zod validation, repair retries, evidence binding, and deterministic category enforcement.

One project can have only one active in-process build. Unchanged profiles retain their validated plan; changed profiles invalidate it, and new documents still trigger corpus-aware planning. Job polling uses a lightweight status response, while full snapshots reload at completion. Persisted non-terminal jobs are marked interrupted after a restart because the MVP has no durable worker queue; this is safer than presenting a stale job as still running.

## 2026-08-18 — Report completed work and isolate retry domains

Progress percentages are based on completed LLM batches, with a separate heartbeat elapsed time for the currently active sub-stage. Time alone must not advance the percentage because it makes a job appear almost complete while one slow request is still outstanding. `ProcessingJob.batchProgress` is an optional shared contract so old persisted jobs remain readable.

Provider transport retry and structured-output repair are deliberately independent. Network failures propagate after the provider's bounded retry policy; only a response that was actually received but fails local JSON/Zod validation enters the repair prompt. This removes multiplicative waits while retaining schema validation and repair quality. Canonical duplicates are collapsed before the single classification pass so each reusable node is classified once.

## 2026-08-18 — Use adaptive task contracts instead of a universal course ontology

Wiki generation is driven by a preset or custom Research Profile plus corpus evidence. Presets
cover course learning, research, literature review, experiments, prediction datasets, business,
policy/standards, technical documentation, personal knowledge, and automatic detection. They are
editable defaults, not separate pipelines. `WikiGenerationPlan` v2 carries the detected mode,
analysis unit, target questions, field rules, relation rules, and quality policy while remaining
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

## 2026-08-18 — Classification uses the complete node context

`WikiNode.type` is the normalized label from the controlled plan. Before choosing it, a dedicated
understanding prompt receives the node summary, properties, source passages with locations,
relation neighborhood, and research goal. The classifier then receives that understanding plus the
original evidence and category definitions. The server validates the returned JSON and category
identifier, but does not run a second classification review loop. If the response is unavailable
or malformed, the node keeps its exact extracted controlled label.

## 2026-08-18 — Entity names are hints, not classification authority

The classifier must reconstruct the node's central subject, function, scope, and evidence from
that complete context before comparing it with every controlled category. A name, extracted type,
formula-looking content, or neighboring node is only a clue and cannot replace the source meaning.
Missing or malformed output uses the already extracted controlled label; it is not sent to another
worker and does not create a review warning.

## 2026-08-20 — Comprehension precedes extraction and classification

Wiki generation uses hierarchical whole-context understanding rather than isolated keyword extraction. Corpus planning first synthesizes distributed evidence from every document into themes and a required-knowledge coverage contract. Each relevance, extraction, and classification batch then reads its complete supplied scope with document, page, section, and block-type context before making item-level decisions.

Extraction performs an internal knowledge inventory, canonical consolidation, and coverage audit before returning structured output. Nodes represent reusable knowledge subjects rather than paragraphs, sentences, headings, or incidental properties; repeated names and notation variants are consolidated as aliases, while independently meaningful subjects remain separate. Coverage includes supported conditions, limitations, exceptions, negative results, and disagreements, but never permits unsupported nodes merely to satisfy a checklist.

Classification compares the reconstructed meaning in the complete node context against all
controlled category definitions and corpus-specific rules. This keeps category selection
domain-neutral while preserving evidence binding and the user's closed type contract.

## 2026-08-20 — Non-empty user type lists are closed contracts

The Research Profile UI accepts knowledge types as comma-separated labels. Server-side profile normalization splits ASCII and Chinese commas, trims whitespace, preserves order, and removes duplicates. A non-empty result sets `WikiGenerationPlan.entityTypePolicy` to `strict`: planning, extraction, classification, and deterministic post-processing may use only those exact labels, and corpus-derived categories cannot be added or removed. The planning worker may enrich the matching labels with corpus-specific definitions and inclusion/exclusion boundaries; it may not change the labels. An empty list remains `open` so automatic/custom Wikis can retain a reusable ontology designed from the corpus.

## 2026-08-20 — Persist edited blueprint presets per project

Built-in blueprint chips remain useful starting points, but users often adapt their wording and
fields to a recurring research workflow. When a non-custom profile is saved, the current profile
is persisted as a project-scoped override under its preset and output language. Selecting that
preset later restores the override; custom profiles remain project profiles rather than silently
changing a built-in template. This keeps reusable defaults stable within a research space without
leaking one project's domain-specific edits into another project.

## 2026-08-20 — Synchronize blueprint edits across open pages

The server remains the source of truth, while same-origin pages use a lightweight
`BroadcastChannel` notification after a successful profile save. A `storage` event is the
compatibility fallback. Pages with unsaved local edits are not overwritten silently; they show a
conflict hint and require the user to save or discard their local draft.

## 2026-08-20 — Compose evidence into domain-neutral mini Wiki pages

Reference-quality Wiki pages are coherent because they preserve a subject's identity, explanatory
logic, scope, evidence, examples, boundaries, and meaningful links, not because they use a physics
or course-specific chapter template. Corpus analysis now identifies that explanatory spine;
relevance filtering retains blocks that fill one of those roles; extraction composes compatible
facets into node summary, properties, and evidence-bound relations; and classification evaluates
the page's central semantic identity rather than the format of a supporting fact. The lens adapts
to the source: unsupported facets are omitted and user-provided type labels remain a closed
contract when present.

## 2026-08-20 — Preserve node understanding, remove only post-classification review

The pipeline still treats “what is this node in this corpus?” and “which allowed category maps to
that meaning?” as two sequential operations. Semantic interpretation continues to run first with
the full evidence context and returns a semantic identity, explanation, decision factors, exact
source excerpt, and confidence. The server validates each item independently so one malformed entry
does not discard an entire batch.

The controlled classifier then receives that interpretation plus the original source context and
may only select an existing plan category. It does not invent categories or replace the source
meaning with a name heuristic. Structured output and controlled-id validation remain in place, but
the former independent recovery/review call and its pending status are deliberately removed.

This decision keeps the system universal. Broad category roles remain persisted schema metadata
and a fallback aid for category-plan creation, but they are not a menu of mandatory node types or
a hard-coded way to classify instances. A strict user type list still remains exact while retaining
the corpus-specific definitions and boundaries the planner produces for those labels.

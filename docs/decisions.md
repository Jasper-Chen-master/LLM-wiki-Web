# Decisions

## 2026-08-13 — Local vertical slice first

Use a filesystem repository and in-process job runner for the MVP. This makes the complete workflow runnable with no database or cloud account while preserving repository and job interfaces for a later migration.

## 2026-08-13 — Optional DeepSeek, never an implicit dependency

DeepSeek is accessed only through `LLMProvider`. Missing configuration activates a clearly marked deterministic demo provider; it does not claim model-derived facts. Production use should set `DEEPSEEK_API_KEY` and replace/demo-check extraction quality.

## 2026-08-17 — Analyze the corpus before defining Wiki categories

Entity types are no longer free-form extraction output. Each build first analyzes distributed samples from every current source together with the approved Research Profile, then creates and validates a persisted `WikiGenerationPlan`. Relevance filtering and extraction receive this plan. A separate global AI classification pass reviews all extracted entities against the same controlled categories, after which a deterministic post-validator maps all provider output back to plan labels.

This staged design costs additional model calls, but it improves classification consistency, makes the active ontology auditable, and prevents obvious semantic drift. General deterministic guardrails cover unambiguous named laws, theorems, theories, models, methods, formulas, experiments, and phenomena; Newton's three laws are only one regression fixture. Ambiguous terms are intentionally left to contextual classification. If final plan generation fails validation, the system conservatively combines categories from the successful corpus analyses rather than reverting to unrestricted types.

## 2026-08-17 — User knowledge types outrank corpus themes

`WikiProfile.entityTypes` defines the required top-level Wiki structure. Corpus analysis can discover missing reusable semantic roles, but cannot promote a chapter topic, individual entity, named equation, or method into a graph category. AI category suggestions are canonicalized to broad role labels and deduplicated against user types. This prevents narrow filters such as `波`, `波动方程`, or `量纲分析` from replacing user-requested classes such as `概念`, `公式`, and `方法`.

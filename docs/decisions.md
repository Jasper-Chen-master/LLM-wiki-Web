# Decisions

## 2026-08-13 — Local vertical slice first

Use a filesystem repository and in-process job runner for the MVP. This makes the complete workflow runnable with no database or cloud account while preserving repository and job interfaces for a later migration.

## 2026-08-13 — Optional DeepSeek, never an implicit dependency

DeepSeek is accessed only through `LLMProvider`. Missing configuration activates a clearly marked deterministic demo provider; it does not claim model-derived facts. Production use should set `DEEPSEEK_API_KEY` and replace/demo-check extraction quality.

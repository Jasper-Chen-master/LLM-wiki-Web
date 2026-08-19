# Goal-Conditioned LLM Wiki

An evidence-first research workspace that turns a user-approved Research Profile plus PDF/DOCX sources into an explorable knowledge graph. It is not a PDF chatbot: raw document blocks, structured knowledge, and retrieval remain separate.

## Run

```powershell
npm.cmd install --cache .npm-cache
npm.cmd run dev
```

Open `http://localhost:5173`. The API runs on `http://localhost:3001`. Copy `.env.example` to `.env` to configure DeepSeek (the current MVP otherwise uses a clearly labelled local demo extractor).

## Workflow

Create a project → upload DOCX Research Profile and PDF/DOCX source files → review/edit the generated profile → confirm → deterministically parse and fingerprint sources → analyze every document in ordered, context-carrying slices → persist a validated document-level knowledge analysis with complete block coverage → freeze a controlled ontology and Candidate Extraction Contract → record a coverage-complete Evidence Claim ledger → let AI create a global Candidate Catalog → consolidate candidates into a persistent Concept Registry → generate stable summaries from canonical evidence → validate and publish evidence-bound graph knowledge → explore graph, Wiki detail, search, chat, and JSON/CSV export. New documents use the frozen ontology and record extension proposals instead of silently replacing it.

## Limitations

PDF/DOCX parsing and extraction are intentionally lightweight in this MVP. Scanned PDFs/OCR and scientific tables require dedicated parsers. The local file repository and in-process runner are suitable for a demo, not multi-user production.

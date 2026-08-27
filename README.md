# Goal-Conditioned LLM Wiki

An evidence-first research workspace that turns a user-approved Research Profile plus PDF/DOCX sources into an explorable knowledge graph. It is not a PDF chatbot: raw document blocks, structured knowledge, and retrieval remain separate.

## Run

```powershell
npm.cmd install --cache .npm-cache
npm.cmd run dev
```

Open `http://localhost:5173`. The API runs on `http://localhost:3001`. Copy `.env.example` to `.env` and fill in `OPENROUTER_API_KEY` to use OpenRouter with z-ai GLM 5.3 Flash (the current MVP otherwise uses a clearly labelled local demo extractor).

## Workflow

Create a project → upload DOCX Research Profile and PDF/DOCX source files → review/edit the generated profile → confirm → analyze the goal against the corpus → plan controlled Wiki categories → filter and extract evidence-backed knowledge → explore graph, Wiki detail, search, chat, and JSON/CSV export.

## Limitations

PDF/DOCX parsing and extraction are intentionally lightweight in this MVP. Scanned PDFs/OCR and scientific tables require dedicated parsers. The local file repository and in-process runner are suitable for a demo, not multi-user production.

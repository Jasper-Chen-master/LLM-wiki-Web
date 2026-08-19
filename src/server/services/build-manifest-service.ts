import { createHash } from "node:crypto";
import type { BuildManifest, DocumentBlock, DocumentRecord, WikiGenerationPlan, WikiProfile } from "../../shared/contracts.js";
import {
  DOCUMENT_CHUNKING_VERSION,
  DOCUMENT_CHUNK_MAX_CHARS,
  DOCUMENT_CHUNK_OVERLAP_CHARS,
  DOCUMENT_PARSER_VERSION,
  ensureDocumentFingerprint,
} from "../document-parser.js";

export const WIKI_SCHEMA_VERSION = "document-analysis-v1+wiki-generation-plan-v3+evidence-claim-ledger-v2+candidate-catalog-v1+semantic-registry-v2";
export const WIKI_PROMPT_VERSIONS = {
  profile: "preference-parser-v2",
  documentAnalysis: "document-analysis-v1",
  documentSynthesis: "document-synthesis-v1",
  generationPlan: "generation-plan-v5",
  relevance: "relevance-v2",
  claimExtraction: "evidence-claim-extraction-v2",
  candidateCatalog: "candidate-catalog-v1",
  semanticConsolidation: "semantic-consolidation-v1",
  wikiSummarization: "wiki-summarization-v2",
};

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => [key, canonicalize(child)]));
}

export function stableJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export async function createBuildManifest(input: {
  projectId: string;
  jobId: string;
  profile: WikiProfile;
  documents: DocumentRecord[];
  blocks: DocumentBlock[];
  ontologyRevision: number;
  plan?: WikiGenerationPlan;
}): Promise<BuildManifest> {
  for (const document of input.documents) await ensureDocumentFingerprint(document);
  const blockCount = new Map<string, number>();
  for (const block of input.blocks) blockCount.set(block.documentId, (blockCount.get(block.documentId) ?? 0) + 1);
  const documents = input.documents.map(document => ({
    documentId: document.id,
    fileName: document.fileName,
    contentHash: document.contentHash ?? "unknown",
    parserEngine: document.parserEngine ?? "legacy-unknown",
    parserVersion: document.parserVersion ?? DOCUMENT_PARSER_VERSION,
    chunkingVersion: document.chunkingVersion ?? "legacy-blocks",
    blockCount: blockCount.get(document.id) ?? document.blockCount ?? 0,
    blockFingerprint: sha256(stableJson(input.blocks
      .filter(block => block.documentId === document.id)
      .map(block => ({ page: block.page, section: block.section, blockType: block.blockType, sourceLocation: block.sourceLocation, text: block.text })))),
  })).sort((left, right) => left.contentHash.localeCompare(right.contentHash) || left.fileName.localeCompare(right.fileName));
  const profileHash = sha256(stableJson(input.profile));
  const provider = process.env.DEEPSEEK_API_KEY?.trim() ? "deepseek" : "demo";
  const model = provider === "deepseek" ? process.env.DEEPSEEK_MODEL ?? "deepseek-chat" : "deterministic-demo";
  const reproducibleInput = {
    profileHash,
    documents: documents.map(document => ({
      contentHash: document.contentHash,
      parserEngine: document.parserEngine,
      parserVersion: document.parserVersion,
      chunkingVersion: document.chunkingVersion,
      blockFingerprint: document.blockFingerprint,
    })),
    parserVersion: DOCUMENT_PARSER_VERSION,
    chunking: {
      version: DOCUMENT_CHUNKING_VERSION,
      maxChars: DOCUMENT_CHUNK_MAX_CHARS,
      overlapChars: DOCUMENT_CHUNK_OVERLAP_CHARS,
    },
    schemaVersion: WIKI_SCHEMA_VERSION,
    promptVersions: WIKI_PROMPT_VERSIONS,
    ontologyRevision: input.ontologyRevision,
    provider,
    model,
    temperature: 0,
  };
  const inputFingerprint = sha256(stableJson(reproducibleInput));
  const generationPlanFingerprint = input.plan
    ? sha256(stableJson({ ...input.plan, createdAt: undefined, frozen: undefined }))
    : undefined;
  return {
    id: `${input.projectId}:manifest:${sha256(`${inputFingerprint}|${input.jobId}`).slice(0, 20)}`,
    version: "1.0",
    projectId: input.projectId,
    jobId: input.jobId,
    createdAt: new Date().toISOString(),
    inputFingerprint,
    profileHash,
    documents,
    schemaVersion: WIKI_SCHEMA_VERSION,
    promptVersions: WIKI_PROMPT_VERSIONS,
    ontologyRevision: input.ontologyRevision,
    provider,
    model,
    temperature: 0,
    generationPlanFingerprint,
  };
}

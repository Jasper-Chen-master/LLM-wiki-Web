import { createHash } from "node:crypto";
import type {
  ConceptRegistryEntry,
  DocumentBlock,
  DocumentKnowledgeAnalysis,
  DocumentKnowledgePointKind,
  DocumentRecord,
  WikiProfile,
} from "../../shared/contracts.js";
import type { PersistedState } from "../store.js";

// Kept separate from the persisted schema because these are untrusted LLM proposals.
// materializeDocumentKnowledgeAnalysis is the only boundary allowed to turn them into stored data.
export interface AnalysisEntityDraft {
  name: string; type?: string; aliases?: string[]; evidenceBlockIds: string[];
}
export interface AnalysisPointDraft {
  kind: DocumentKnowledgePointKind; title: string; statement: string;
  status: "observed" | "reported" | "inferred"; scope?: string;
  conditions?: Record<string, string | number>; importance: number; confidence: number;
  evidenceBlockIds: string[];
}
export interface AnalysisTopicDraft { title: string; reason: string; evidenceBlockIds: string[]; }
export interface AnalysisConceptLinkDraft { registryEntryId: string; reason: string; evidenceBlockIds: string[]; }
export interface DocumentAnalysisSliceDraft {
  summary: string; relevance: DocumentKnowledgeAnalysis["relevance"]; relevanceReason: string;
  sourceBoundary: string; themes: string[]; entities: AnalysisEntityDraft[];
  knowledgePoints: AnalysisPointDraft[]; suggestedWikiTopics: AnalysisTopicDraft[];
  existingConceptLinks: AnalysisConceptLinkDraft[];
  coverage: Array<{ blockId: string; status: "analyzed" | "unresolved"; reason: string }>;
}
export interface DocumentAnalysisSynthesisDraft {
  summary: string; relevance: DocumentKnowledgeAnalysis["relevance"]; relevanceReason: string;
  sourceBoundary: string; themes: string[]; entities: AnalysisEntityDraft[];
  knowledgePoints: AnalysisPointDraft[]; suggestedWikiTopics: AnalysisTopicDraft[];
  existingConceptLinks: AnalysisConceptLinkDraft[];
}

const normalized = (value: string) => value.normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase();
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const unique = <T>(items: T[], key: (item: T) => string) => {
  const seen = new Set<string>();
  return items.filter(item => {
    const itemKey = key(item);
    if (!itemKey || seen.has(itemKey)) return false;
    seen.add(itemKey);
    return true;
  });
};
const clamp = (value: number) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

export function compactDocumentAnalyses(analyses: DocumentKnowledgeAnalysis[]) {
  return analyses.map(analysis => ({
    documentId: analysis.documentId,
    relevance: analysis.relevance,
    relevanceReason: analysis.relevanceReason,
    sourceBoundary: analysis.sourceBoundary,
    summary: analysis.summary.slice(0, 1_000),
    themes: analysis.themes,
    entities: analysis.entities.slice(0, 30).map(entity => ({ name: entity.name, type: entity.type, aliases: entity.aliases })),
    knowledgePoints: [...analysis.knowledgePoints].sort((left, right) => right.importance - left.importance)
      .slice(0, 40).map(point => ({
      kind: point.kind, title: point.title, statement: point.statement, status: point.status,
      scope: point.scope, conditions: point.conditions, importance: point.importance,
    })),
    suggestedWikiTopics: analysis.suggestedWikiTopics.slice(0, 16).map(topic => ({ title: topic.title, reason: topic.reason })),
    unresolvedBlockCount: analysis.coverage.unresolvedBlockIds.length,
  }));
}

export function materializeDocumentKnowledgeAnalysis(input: {
  projectId: string;
  document: DocumentRecord;
  profile: WikiProfile;
  blocks: DocumentBlock[];
  slices: DocumentAnalysisSliceDraft[];
  synthesis?: DocumentAnalysisSynthesisDraft;
  registry: ConceptRegistryEntry[];
  now?: string;
}): DocumentKnowledgeAnalysis {
  const allowedBlockIds = new Set(input.blocks.filter(block => block.documentId === input.document.id).map(block => block.id));
  const allowedRegistryIds = new Set(input.registry.filter(entry => entry.projectId === input.projectId).map(entry => entry.id));
  const filterBlockIds = (ids: string[]) => [...new Set(ids.filter(id => allowedBlockIds.has(id)))];
  const sliceEvidenceIds = new Set(input.slices.flatMap(slice => [
    ...slice.entities.flatMap(entity => entity.evidenceBlockIds),
    ...slice.knowledgePoints.flatMap(point => point.evidenceBlockIds),
    ...slice.suggestedWikiTopics.flatMap(topic => topic.evidenceBlockIds),
    ...slice.existingConceptLinks.flatMap(link => link.evidenceBlockIds),
  ]).filter(id => allowedBlockIds.has(id)));
  const filterEvidenceIds = (ids: string[], source: DocumentAnalysisSliceDraft | DocumentAnalysisSynthesisDraft) =>
    filterBlockIds(ids).filter(id => source !== input.synthesis || sliceEvidenceIds.has(id));
  const sources = input.synthesis ? [input.synthesis, ...input.slices] : input.slices;
  const fallbackSummary = input.profile.outputLanguage === "zh"
    ? "文档分析未能生成可靠摘要；所有未确认区块均保留为 unresolved。"
    : "Document analysis did not produce a reliable summary; every unconfirmed block remains unresolved.";
  const summary = input.synthesis?.summary?.trim() || input.slices.map(slice => slice.summary.trim()).filter(Boolean).join(" ").slice(0, 2_500) || fallbackSummary;
  const relevance = input.synthesis?.relevance ?? input.slices.find(slice => slice.relevance === "direct")?.relevance
    ?? input.slices.find(slice => slice.relevance === "partial")?.relevance
    ?? input.slices.find(slice => slice.relevance === "contextual")?.relevance
    ?? "out_of_scope";
  const relevanceReason = input.synthesis?.relevanceReason?.trim()
    || input.slices.map(slice => slice.relevanceReason.trim()).filter(Boolean).join(" ").slice(0, 800)
    || fallbackSummary;
  const sourceBoundary = input.synthesis?.sourceBoundary?.trim()
    || input.slices.map(slice => slice.sourceBoundary.trim()).filter(Boolean).join(" ").slice(0, 1_000)
    || fallbackSummary;
  const entities = unique(sources.flatMap(source => source.entities.map(entity => ({
    name: entity.name.trim(), type: entity.type?.trim() || undefined,
    aliases: [...new Set(entity.aliases?.map(alias => alias.trim()).filter(Boolean) ?? [])].slice(0, 20),
    evidenceBlockIds: filterEvidenceIds(entity.evidenceBlockIds, source),
  }))).filter(entity => entity.name && entity.evidenceBlockIds.length), entity => normalized(entity.name)).slice(0, 160);
  const pointDrafts = unique(sources.flatMap(source => source.knowledgePoints.map(point => ({
    ...point,
    title: point.title.trim(), statement: point.statement.trim(), scope: point.scope?.trim() || undefined,
    conditions: point.conditions ?? {}, importance: clamp(point.importance), confidence: clamp(point.confidence),
    evidenceBlockIds: filterEvidenceIds(point.evidenceBlockIds, source),
  }))).filter(point => point.title && point.statement && point.evidenceBlockIds.length), point => `${point.kind}|${normalized(point.title)}|${normalized(point.statement)}`).slice(0, 320);
  const knowledgePoints = pointDrafts.map(point => ({
    ...point,
    id: `${input.document.id}:analysis-point:${hash(`${point.kind}|${point.title}|${point.statement}|${point.evidenceBlockIds.join("|")}`).slice(0, 20)}`,
  }));
  const suggestedWikiTopics = unique(sources.flatMap(source => source.suggestedWikiTopics.map(topic => ({
    title: topic.title.trim(), reason: topic.reason.trim(), evidenceBlockIds: filterEvidenceIds(topic.evidenceBlockIds, source),
  }))).filter(topic => topic.title && topic.reason && topic.evidenceBlockIds.length), topic => normalized(topic.title)).slice(0, 80);
  const existingConceptLinks = unique(sources.flatMap(source => source.existingConceptLinks.map(link => ({
    registryEntryId: link.registryEntryId, reason: link.reason.trim(), evidenceBlockIds: filterEvidenceIds(link.evidenceBlockIds, source),
  }))).filter(link => allowedRegistryIds.has(link.registryEntryId) && link.reason && link.evidenceBlockIds.length), link => `${link.registryEntryId}|${link.evidenceBlockIds.join("|")}`).slice(0, 80);
  const analyzedById = new Set(input.slices.flatMap(slice => slice.coverage)
    .filter(item => item.status === "analyzed" && allowedBlockIds.has(item.blockId)).map(item => item.blockId));
  const unresolvedById = new Set(input.slices.flatMap(slice => slice.coverage)
    .filter(item => item.status === "unresolved" && allowedBlockIds.has(item.blockId)).map(item => item.blockId));
  const analyzedBlockIds: string[] = [];
  const unresolvedBlockIds: string[] = [];
  for (const block of input.blocks) {
    if (block.documentId !== input.document.id) continue;
    if (analyzedById.has(block.id) && !unresolvedById.has(block.id)) analyzedBlockIds.push(block.id);
    else unresolvedBlockIds.push(block.id);
  }
  const contentHash = input.document.contentHash || hash(input.blocks.map(block => `${block.id}\n${block.text}`).join("\n"));
  const profileHash = hash(JSON.stringify(input.profile));
  return {
    id: `${input.projectId}:document-analysis:${hash(`${input.document.id}|${contentHash}|${profileHash}`).slice(0, 20)}`,
    version: "1.0", projectId: input.projectId, documentId: input.document.id,
    contentHash, profileHash, outputLanguage: input.profile.outputLanguage ?? "en",
    relevance, relevanceReason, sourceBoundary, summary: summary.slice(0, 2_500),
    themes: [...new Set(sources.flatMap(source => source.themes.map(theme => theme.trim())).filter(Boolean))].slice(0, 32),
    entities, knowledgePoints, suggestedWikiTopics, existingConceptLinks,
    coverage: { analyzedBlockIds, unresolvedBlockIds },
    createdAt: input.now ?? new Date().toISOString(),
  };
}

export function replaceDocumentAnalyses(
  state: PersistedState,
  projectId: string,
  documentIds: Set<string>,
  replacements: DocumentKnowledgeAnalysis[],
) {
  state.documentAnalyses = state.documentAnalyses.filter(analysis => (
    analysis.projectId !== projectId || !documentIds.has(analysis.documentId)
  ));
  state.documentAnalyses.push(...replacements);
}

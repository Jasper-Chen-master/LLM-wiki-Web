import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";
import type { DocumentBlock, Evidence, WikiEdge, WikiNode } from "../../shared/contracts.js";

/** A minimal extraction shape so providers can evolve without leaking into graph persistence. */
export interface ExtractedEntity {
  name: string;
  canonicalName?: string;
  type?: string;
  aliases?: string[];
  summary?: string;
  properties?: Record<string, string | number>;
  importance?: number;
  importanceReason?: string;
  confidence?: number;
  confidenceReason?: string;
  evidenceIds?: string[];
}

export interface ExtractedRelation {
  source: string;
  target: string;
  relationType: string;
  confidence?: number;
  confidenceReason?: string;
  evidenceIds?: string[];
  relationStatus?: WikiEdge["relationStatus"];
}

export interface GraphBuildInput {
  projectId: string;
  entities: ExtractedEntity[];
  relations: ExtractedRelation[];
  evidence: Evidence[];
}

export interface GraphBuildResult {
  nodes: WikiNode[];
  edges: WikiEdge[];
  /** Candidates whose evidence could not be found are intentionally not persisted. */
  rejected: Array<{ kind: "entity" | "relation"; name: string; missingEvidenceIds: string[] }>;
}

const idFor = (projectId: string, kind: string, value: string) =>
  `${projectId}:${kind}:${createHash("sha256").update(value).digest("hex").slice(0, 16)}`;

/**
 * Normalization is deliberately conservative: it handles formatting variants while preserving
 * meaningful punctuation (for example chemical formulas) for display and human review.
 */
export function normalizeEntityName(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[‐‑‒–—]/g, "-")
    .replace(/[\s_\-]+/g, " ")
    .replace(/[^\p{L}\p{N}\s.+#]/gu, "")
    .trim()
    .toLocaleLowerCase();
}

const unique = <T>(values: T[]) => [...new Set(values)];
const clamp = (value: number | undefined, fallback: number) => Math.max(0, Math.min(1, value ?? fallback));

type EvidenceSignal = { confidence: number; importance: number; confidenceReason: string; importanceReason: string };

/**
 * Scores are evidence-derived fallbacks, not guesses: repeated evidence, independent source
 * documents, and sufficiently substantive source text increase the score with diminishing
 * returns. Provider scores remain available when explicitly accompanied by their rationale.
 */
function evidenceSignal(ids: string[], evidence: Evidence[], occurrences = 1, propertyCount = 0): EvidenceSignal {
  const supporting = evidence.filter(item => ids.includes(item.id));
  const documents = new Set(supporting.map(item => item.documentId));
  const blocks = new Set(supporting.map(item => item.blockId));
  const saturation = (count: number) => 1 - Math.exp(-count);
  const evidenceCoverage = saturation(supporting.length);
  const sourceDiversity = saturation(documents.size);
  const blockDiversity = saturation(blocks.size);
  const textSubstantiation = supporting.length
    ? supporting.reduce((sum, item) => sum + Math.min(item.originalText.trim().length / 600, 1), 0) / supporting.length
    : 0;
  const repeatedMentions = saturation(occurrences);
  const confidence = clamp(.12 + .38 * evidenceCoverage + .22 * sourceDiversity + .18 * textSubstantiation + .10 * blockDiversity, .12);
  const importance = clamp(.08 + .27 * evidenceCoverage + .24 * blockDiversity + .18 * sourceDiversity + .13 * repeatedMentions + .10 * saturation(propertyCount), .08);
  const basis = `${supporting.length} 条证据、${documents.size} 个来源文档、${blocks.size} 个证据块`;
  return { confidence, importance, confidenceReason: `基于${basis}及原文完整度计算。`, importanceReason: `基于${basis}、重复出现次数和结构化属性覆盖度计算。` };
}

function validEvidenceIds(ids: string[] | undefined, evidenceIds: Set<string>) {
  const requested = unique(ids ?? []);
  return { valid: requested.filter(id => evidenceIds.has(id)), missing: requested.filter(id => !evidenceIds.has(id)) };
}

/** Merge exact normalized names and aliases. Ambiguous semantic merges remain a future review/LLM task. */
export function deduplicateEntities(projectId: string, entities: ExtractedEntity[], evidence: Evidence[]) {
  const evidenceIds = new Set(evidence.map(item => item.id));
  const rejected: GraphBuildResult["rejected"] = [];
  const groups = new Map<string, ExtractedEntity[]>();

  for (const entity of entities) {
    const name = entity.canonicalName ?? entity.name;
    const normalized = normalizeEntityName(name);
    if (!normalized) continue;
    const { valid, missing } = validEvidenceIds(entity.evidenceIds, evidenceIds);
    if (missing.length || !valid.length) {
      rejected.push({ kind: "entity", name, missingEvidenceIds: missing.length ? missing : ["evidence required"] });
      continue;
    }
    const candidate = { ...entity, canonicalName: name, evidenceIds: valid };
    const aliases = [name, ...(entity.aliases ?? [])].map(normalizeEntityName).filter(Boolean);
    const matchingKey = [...groups.keys()].find(key => aliases.includes(key)) ?? normalized;
    groups.set(matchingKey, [...(groups.get(matchingKey) ?? []), candidate]);
  }

  const nodes = [...groups.entries()].map(([normalized, group]) => {
    const primary = group[0];
    const aliases = unique(group.flatMap(item => [item.name, item.canonicalName ?? item.name, ...(item.aliases ?? [])]))
      .filter(alias => normalizeEntityName(alias) !== normalized);
    const properties = Object.assign({}, ...group.map(item => item.properties ?? {}));
    const evidenceIds = unique(group.flatMap(item => item.evidenceIds ?? []));
    const signal = evidenceSignal(evidenceIds, evidence, group.length, Object.keys(properties).length);
    const scored = group.map(item => ({
      importance: item.importance === undefined ? signal.importance : clamp(item.importance, signal.importance),
      importanceReason: item.importanceReason ?? signal.importanceReason,
      confidence: item.confidence === undefined ? signal.confidence : clamp(item.confidence, signal.confidence),
      confidenceReason: item.confidenceReason ?? signal.confidenceReason,
    }));
    const bestImportance = scored.reduce((best, item) => item.importance > best.importance ? item : best);
    const bestConfidence = scored.reduce((best, item) => item.confidence > best.confidence ? item : best);
    return {
      id: idFor(projectId, "node", normalized),
      canonicalName: primary.canonicalName ?? primary.name,
      displayName: primary.name,
      type: primary.type ?? "Concept",
      aliases,
      summary: group.map(item => item.summary).find(Boolean) ?? "",
      properties,
      importance: bestImportance.importance, importanceReason: bestImportance.importanceReason,
      confidence: bestConfidence.confidence, confidenceReason: bestConfidence.confidenceReason,
      evidenceIds,
    } satisfies WikiNode;
  });
  return { nodes, rejected };
}

/** Builds only relations with an existing evidence trail and resolved source/target nodes. */
export function buildEvidenceBoundGraph(input: GraphBuildInput): GraphBuildResult {
  const { nodes, rejected } = deduplicateEntities(input.projectId, input.entities, input.evidence);
  const evidenceIds = new Set(input.evidence.map(item => item.id));
  const byName = new Map<string, WikiNode>();
  for (const node of nodes) for (const name of [node.canonicalName, node.displayName, ...node.aliases]) byName.set(normalizeEntityName(name), node);

  const edgeMap = new Map<string, WikiEdge>();
  for (const relation of input.relations) {
    const source = byName.get(normalizeEntityName(relation.source));
    const target = byName.get(normalizeEntityName(relation.target));
    const { valid, missing } = validEvidenceIds(relation.evidenceIds, evidenceIds);
    const label = `${relation.source} ${relation.relationType} ${relation.target}`;
    if (!source || !target || source.id === target.id || missing.length || !valid.length) {
      rejected.push({ kind: "relation", name: label, missingEvidenceIds: missing.length ? missing : ["unresolved node or evidence required"] });
      continue;
    }
    const key = `${source.id}|${relation.relationType.trim().toLowerCase()}|${target.id}`;
    const existing = edgeMap.get(key);
    if (existing) {
      existing.evidenceIds = unique([...existing.evidenceIds, ...valid]);
      const signal = evidenceSignal(existing.evidenceIds, input.evidence);
      const candidateConfidence = relation.confidence === undefined ? signal.confidence : clamp(relation.confidence, signal.confidence);
      if (candidateConfidence >= existing.confidence) {
        existing.confidence = candidateConfidence;
        existing.confidenceReason = relation.confidenceReason ?? signal.confidenceReason;
      }
      continue;
    }
    const signal = evidenceSignal(valid, input.evidence);
    edgeMap.set(key, {
      id: idFor(input.projectId, "edge", key), sourceNodeId: source.id, targetNodeId: target.id,
      relationType: relation.relationType.trim(), direction: "directed", confidence: relation.confidence === undefined ? signal.confidence : clamp(relation.confidence, signal.confidence), confidenceReason: relation.confidenceReason ?? signal.confidenceReason,
      evidenceIds: valid, relationStatus: relation.relationStatus ?? "inferred",
    });
  }
  // If the model omitted semantic links, connect concepts co-mentioned in the same evidence
  // block. These edges are explicitly marked inferred and retain the shared source evidence.
  const byEvidence = new Map<string, WikiNode[]>();
  for (const node of nodes) for (const evidenceId of node.evidenceIds) byEvidence.set(evidenceId, [...(byEvidence.get(evidenceId) ?? []), node]);
  for (const [evidenceId, members] of byEvidence) {
    for (let index = 0; index < Math.min(members.length, 8); index++) for (let other = index + 1; other < Math.min(members.length, 8); other++) {
      const source = members[index], target = members[other]; const key = `${source.id}|related_to|${target.id}`;
      if (edgeMap.has(key)) continue;
      const signal = evidenceSignal([evidenceId], input.evidence);
      edgeMap.set(key, { id: idFor(input.projectId, "edge", key), sourceNodeId: source.id, targetNodeId: target.id, relationType: "related_to", direction: "directed", confidence: signal.confidence, confidenceReason: `同一证据块共现；${signal.confidenceReason}`, evidenceIds: [evidenceId], relationStatus: "inferred" });
    }
  }
  return { nodes, edges: [...edgeMap.values()], rejected };
}

/**
 * Compatibility adapter for the job pipeline. It materializes evidence from the filtered raw
 * blocks first, then accepts either `entities`/`relations` or `nodes`/`edges` extraction shapes.
 * This keeps the persistence boundary evidence-first while provider output contracts mature.
 */
export function buildGraph(projectId: string, extraction: unknown, blocks: DocumentBlock[]) {
  const evidence = blocks.map(block => ({
    id: randomUUID(), documentId: block.documentId, page: block.page, section: block.section,
    blockId: block.id, originalText: block.text, status: "reported" as const,
  }));
  const raw = extraction as { entities?: ExtractedEntity[]; nodes?: ExtractedEntity[]; relations?: ExtractedRelation[]; edges?: ExtractedRelation[] };
  // Providers naturally cite raw block ids. Convert those citations to the persistent
  // Evidence ids created above before validation; this preserves the provenance chain.
  const evidenceByBlockId = new Map(evidence.map(item => [item.blockId, item.id]));
  // Strict provenance: an item must cite real block ids. Items without evidence are NOT silently
  // bound to the first evidence block (that collapsed every node onto one shared evidence and made
  // confidence scores meaningless); they are rejected downstream as evidence-ungrounded.
  const withFallbackEvidence = <T extends { evidenceIds?: string[] }>(items: T[] | undefined) =>
    (items ?? []).map(item => ({ ...item, evidenceIds: (item.evidenceIds ?? []).map(id => evidenceByBlockId.get(id) ?? id) }));
  const graph = buildEvidenceBoundGraph({
    projectId, evidence,
    entities: withFallbackEvidence(raw.entities ?? raw.nodes),
    relations: withFallbackEvidence(raw.relations ?? raw.edges),
  });
  return { ...graph, evidence };
}

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
  confidence?: number;
  evidenceIds?: string[];
}

export interface ExtractedRelation {
  source: string;
  target: string;
  relationType: string;
  confidence?: number;
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
    return {
      id: idFor(projectId, "node", normalized),
      canonicalName: primary.canonicalName ?? primary.name,
      displayName: primary.name,
      type: primary.type ?? "Concept",
      aliases,
      summary: group.map(item => item.summary).find(Boolean) ?? "",
      properties,
      importance: Math.max(...group.map(item => clamp(item.importance, 0.5))),
      confidence: Math.max(...group.map(item => clamp(item.confidence, 0.5))),
      evidenceIds: unique(group.flatMap(item => item.evidenceIds ?? [])),
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
      existing.confidence = Math.max(existing.confidence, clamp(relation.confidence, 0.5));
      continue;
    }
    edgeMap.set(key, {
      id: idFor(input.projectId, "edge", key), sourceNodeId: source.id, targetNodeId: target.id,
      relationType: relation.relationType.trim(), direction: "directed", confidence: clamp(relation.confidence, 0.5),
      evidenceIds: valid, relationStatus: relation.relationStatus ?? "inferred",
    });
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
  const withFallbackEvidence = <T extends { evidenceIds?: string[] }>(items: T[] | undefined) =>
    (items ?? []).map(item => ({ ...item, evidenceIds: item.evidenceIds?.length ? item.evidenceIds.map(id => evidenceByBlockId.get(id) ?? id) : evidence.slice(0, 1).map(value => value.id) }));
  const graph = buildEvidenceBoundGraph({
    projectId, evidence,
    entities: withFallbackEvidence(raw.entities ?? raw.nodes),
    relations: withFallbackEvidence(raw.relations ?? raw.edges),
  });
  return { ...graph, evidence };
}

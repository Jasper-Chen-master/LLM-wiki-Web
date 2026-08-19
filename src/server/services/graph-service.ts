import { createHash } from "node:crypto";
import type { DocumentBlock, Evidence, WikiClassificationDecision, WikiEdge, WikiGenerationPlan, WikiNode, WikiSemanticMember } from "../../shared/contracts.js";
import type { PersistedState } from "../store.js";

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
  classification?: WikiClassificationDecision;
  registryEntryId?: string;
  semanticMembers?: WikiSemanticMember[];
  claimIds?: string[];
}

export interface ExtractedRelation {
  source: string;
  target: string;
  relationType: string;
  confidence?: number;
  confidenceReason?: string;
  evidenceIds?: string[];
  relationStatus?: WikiEdge["relationStatus"];
  conditions?: Record<string, string | number>;
  scope?: string;
}

export interface GraphBuildInput {
  projectId: string;
  entities: ExtractedEntity[];
  relations: ExtractedRelation[];
  evidence: Evidence[];
  plan?: WikiGenerationPlan;
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
    const matchingKey = entity.registryEntryId
      ?? [...groups.keys()].find(key => aliases.includes(key))
      ?? normalized;
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
    const classification = group.map(item => item.classification).filter((item): item is WikiClassificationDecision => Boolean(item))
      .sort((a, b) => b.confidence - a.confidence)[0];
    const semanticMembers = [...new Map(group.flatMap(item => item.semanticMembers ?? [])
      .map(member => [member.candidateId, member])).values()];
    const registryEntryId = group.map(item => item.registryEntryId).find(Boolean);
    return {
      id: registryEntryId ?? idFor(projectId, "node", normalized),
      canonicalName: primary.canonicalName ?? primary.name,
      displayName: primary.name,
      type: primary.type ?? "Concept",
      aliases,
      summary: group.map(item => item.summary).find(Boolean) ?? "",
      properties,
      importance: bestImportance.importance, importanceReason: bestImportance.importanceReason,
      confidence: bestConfidence.confidence, confidenceReason: bestConfidence.confidenceReason,
      evidenceIds, classification, registryEntryId, semanticMembers,
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
  const normalizedLabel = (value: string) => value.normalize("NFKC").trim().toLocaleLowerCase();
  const categoryByLabel = new Map((input.plan?.categories ?? []).map(category => [normalizedLabel(category.label), category]));
  const relationRuleByLabel = new Map((input.plan?.relationRules ?? []).map(rule => [normalizedLabel(rule.label), rule]));
  const allowedRelationLabels = new Set([
    ...(input.plan?.relationTypes ?? []), ...(input.plan?.relationRules ?? []).map(rule => rule.label),
  ].map(normalizedLabel));
  for (const relation of input.relations) {
    const source = byName.get(normalizeEntityName(relation.source));
    const target = byName.get(normalizeEntityName(relation.target));
    const { valid, missing } = validEvidenceIds(relation.evidenceIds, evidenceIds);
    const label = `${relation.source} ${relation.relationType} ${relation.target}`;
    const relationKey = normalizedLabel(relation.relationType);
    const rule = relationRuleByLabel.get(relationKey);
    const sourceCategory = source ? categoryByLabel.get(normalizedLabel(source.type)) : undefined;
    const targetCategory = target ? categoryByLabel.get(normalizedLabel(target.type)) : undefined;
    const invalidTypePair = Boolean(rule && (
      (rule.allowedSourceCategoryIds.length && (!sourceCategory || !rule.allowedSourceCategoryIds.some(id => normalizedLabel(id) === normalizedLabel(sourceCategory.id))))
      || (rule.allowedTargetCategoryIds.length && (!targetCategory || !rule.allowedTargetCategoryIds.some(id => normalizedLabel(id) === normalizedLabel(targetCategory.id))))
    ));
    const invalidInference = relation.relationStatus === "inferred" && rule && !rule.allowInferred;
    const missingConditions = Boolean(rule?.requiresConditions && !Object.keys(relation.conditions ?? {}).length);
    const belowThreshold = relation.confidence !== undefined
      && relation.confidence < (input.plan?.qualityPolicy?.relationThreshold ?? 0);
    if (!source || !target || source.id === target.id || missing.length || !valid.length
      || (input.plan && !allowedRelationLabels.has(relationKey)) || invalidTypePair || invalidInference || missingConditions || belowThreshold) {
      rejected.push({ kind: "relation", name: label, missingEvidenceIds: missing.length ? missing : ["unresolved node or evidence required"] });
      continue;
    }
    const endpoints = rule?.symmetric ? [source.id, target.id].sort() : [source.id, target.id];
    const key = `${endpoints[0]}|${relationKey}|${endpoints[1]}`;
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
      relationType: rule?.label ?? relation.relationType.trim(), direction: rule?.symmetric ? "symmetric" : "directed", confidence: relation.confidence === undefined ? signal.confidence : clamp(relation.confidence, signal.confidence), confidenceReason: relation.confidenceReason ?? signal.confidenceReason,
      evidenceIds: valid, relationStatus: relation.relationStatus ?? "reported", conditions: relation.conditions, scope: relation.scope,
    });
  }
  return { nodes, edges: [...edgeMap.values()], rejected };
}

/**
 * Compatibility adapter for the job pipeline. It materializes evidence from the filtered raw
 * blocks first, then accepts either `entities`/`relations` or `nodes`/`edges` extraction shapes.
 * This keeps the persistence boundary evidence-first while provider output contracts mature.
 */
export function buildGraph(projectId: string, extraction: unknown, blocks: DocumentBlock[], plan?: WikiGenerationPlan) {
  const evidence = blocks.map(block => ({
    id: idFor(projectId, "evidence", `${block.id}|reported`), documentId: block.documentId, page: block.page, section: block.section,
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
    relations: withFallbackEvidence(raw.relations ?? raw.edges), plan,
  });
  return { ...graph, evidence };
}

/**
 * Removes evidence derived from documents that are no longer part of a project, then prunes
 * only the graph records which no longer have any supporting evidence. This intentionally
 * leaves shared nodes and relations intact when another document still supports them.
 */
export function removeDocumentKnowledge(state: PersistedState, projectId: string, documentIds: Set<string>) {
  if (!documentIds.size) return;
  const removedBlockIds = new Set(state.blocks.filter(block => documentIds.has(block.documentId)).map(block => block.id));
  const removedEvidenceIds = new Set(state.evidence.filter(item => documentIds.has(item.documentId)).map(item => item.id));
  state.blocks = state.blocks.filter(block => !documentIds.has(block.documentId));
  state.evidence = state.evidence.filter(item => !removedEvidenceIds.has(item.id));

  const isProjectNode = (node: WikiNode) => node.id.startsWith(`${projectId}:`);
  const isProjectEdge = (edge: WikiEdge) => edge.id.startsWith(`${projectId}:`);
  const survivingNodes = state.nodes.map(node => isProjectNode(node)
    ? { ...node, evidenceIds: node.evidenceIds.filter(id => !removedEvidenceIds.has(id)) }
    : node,
  ).filter(node => !isProjectNode(node) || node.evidenceIds.length > 0);
  const survivingNodeIds = new Set(survivingNodes.map(node => node.id));
  state.nodes = survivingNodes;
  state.edges = state.edges.map(edge => isProjectEdge(edge)
    ? { ...edge, evidenceIds: edge.evidenceIds.filter(id => !removedEvidenceIds.has(id)) }
    : edge,
  ).filter(edge => !isProjectEdge(edge) || (
    edge.evidenceIds.length > 0 && survivingNodeIds.has(edge.sourceNodeId) && survivingNodeIds.has(edge.targetNodeId)
  ));
  state.knowledgeCandidates = state.knowledgeCandidates.map(candidate => candidate.projectId === projectId
    ? {
      ...candidate,
      evidenceBlockIds: candidate.evidenceBlockIds.filter(id => !removedBlockIds.has(id)),
      sourceDocumentIds: candidate.sourceDocumentIds.filter(id => !documentIds.has(id)),
    }
    : candidate,
  ).filter(candidate => candidate.projectId !== projectId || candidate.evidenceBlockIds.length > 0);
  const survivingCandidateIds = new Set(state.knowledgeCandidates
    .filter(candidate => candidate.projectId === projectId)
    .map(candidate => candidate.id));
  state.conceptRegistry = state.conceptRegistry.map(entry => {
    if (entry.projectId !== projectId) return entry;
    const evidenceBlockIds = entry.evidenceBlockIds.filter(id => !removedBlockIds.has(id));
    return {
      ...entry,
      evidenceBlockIds,
      memberCandidateIds: entry.memberCandidateIds.filter(id => survivingCandidateIds.has(id)),
      semanticMembers: entry.semanticMembers.filter(member => survivingCandidateIds.has(member.candidateId)),
      status: evidenceBlockIds.length ? entry.status : "orphaned" as const,
      updatedAt: new Date().toISOString(),
    };
  });
  state.evidenceClaims = state.evidenceClaims.filter(claim => (
    claim.projectId !== projectId || !removedBlockIds.has(claim.blockId)
  ));
  const survivingClaimIds = new Set(state.evidenceClaims
    .filter(claim => claim.projectId === projectId)
    .map(claim => claim.id));
  state.evidenceClaimCoverage = state.evidenceClaimCoverage.filter(coverage => (
    coverage.projectId !== projectId || !removedBlockIds.has(coverage.blockId)
  ));
  state.conceptRegistry = state.conceptRegistry.map(entry => entry.projectId !== projectId ? entry : {
    ...entry,
    claimIds: entry.claimIds?.filter(id => survivingClaimIds.has(id)),
  });
  for (const proposal of state.ontologyExtensionProposals) {
    if (proposal.projectId !== projectId || proposal.status !== "pending") continue;
    proposal.sourceDocumentIds = proposal.sourceDocumentIds.filter(id => !documentIds.has(id));
    if (!proposal.sourceDocumentIds.length) proposal.status = "superseded";
  }
}

/** Clears one project's derived graph while retaining parsed document blocks for an efficient
 * profile-driven rebuild. Evidence still referenced by another project is preserved defensively. */
export function clearProjectGraphKnowledge(state: PersistedState, projectId: string) {
  const projectNodeIds = new Set(state.nodes.filter(node => node.id.startsWith(`${projectId}:`)).map(node => node.id));
  const projectEdgeIds = new Set(state.edges.filter(edge => edge.id.startsWith(`${projectId}:`)).map(edge => edge.id));
  const candidateEvidenceIds = new Set([
    ...state.nodes.filter(node => projectNodeIds.has(node.id)).flatMap(node => node.evidenceIds),
    ...state.edges.filter(edge => projectEdgeIds.has(edge.id)).flatMap(edge => edge.evidenceIds),
  ]);
  state.nodes = state.nodes.filter(node => !projectNodeIds.has(node.id));
  state.edges = state.edges.filter(edge => !projectEdgeIds.has(edge.id));
  const survivingEvidenceIds = new Set([...state.nodes, ...state.edges].flatMap(item => item.evidenceIds));
  state.evidence = state.evidence.filter(item => !candidateEvidenceIds.has(item.id) || survivingEvidenceIds.has(item.id));
  state.knowledgeCandidates = state.knowledgeCandidates.filter(candidate => candidate.projectId !== projectId);
  state.evidenceClaims = state.evidenceClaims.filter(claim => claim.projectId !== projectId);
  state.evidenceClaimCoverage = state.evidenceClaimCoverage.filter(coverage => coverage.projectId !== projectId);
}

/** Merges an incrementally-built graph while preserving stable node and edge identifiers. */
export function mergeGraphInto(state: PersistedState, projectId: string, graph: Pick<GraphBuildResult, "nodes" | "edges"> & { evidence: Evidence[] }) {
  const evidenceById = new Map(state.evidence.map((item, index) => [item.id, index]));
  for (const item of graph.evidence) {
    const existingIndex = evidenceById.get(item.id);
    if (existingIndex === undefined) evidenceById.set(item.id, state.evidence.push(item) - 1);
    else state.evidence[existingIndex] = item;
  }
  const nodeById = new Map(state.nodes.map((node, index) => [node.id, index]));
  for (const node of graph.nodes) {
    const existingIndex = nodeById.get(node.id);
    if (existingIndex === undefined) { nodeById.set(node.id, state.nodes.push(node) - 1); continue; }
    const existing = state.nodes[existingIndex];
    const incomingHasHigherConfidence = node.confidence > existing.confidence;
    const incomingHasHigherImportance = node.importance > existing.importance;
    state.nodes[existingIndex] = {
      ...existing,
      evidenceIds: unique([...existing.evidenceIds, ...node.evidenceIds]),
      properties: Object.assign({}, existing.properties, node.properties),
      summary: existing.summary || node.summary,
      confidence: Math.max(existing.confidence, node.confidence),
      confidenceReason: incomingHasHigherConfidence ? node.confidenceReason : existing.confidenceReason,
      importance: Math.max(existing.importance, node.importance),
      importanceReason: incomingHasHigherImportance ? node.importanceReason : existing.importanceReason,
      classification: !existing.classification || (node.classification?.confidence ?? 0) > existing.classification.confidence
        ? node.classification : existing.classification,
      registryEntryId: node.registryEntryId ?? existing.registryEntryId,
      semanticMembers: [...new Map([...(existing.semanticMembers ?? []), ...(node.semanticMembers ?? [])]
        .map(member => [member.candidateId, member])).values()],
    };
  }
  const edgeById = new Map(state.edges.map((edge, index) => [edge.id, index]));
  for (const edge of graph.edges) {
    const existingIndex = edgeById.get(edge.id);
    if (existingIndex === undefined) { edgeById.set(edge.id, state.edges.push(edge) - 1); continue; }
    const existing = state.edges[existingIndex];
    const incomingHasHigherConfidence = edge.confidence > existing.confidence;
    state.edges[existingIndex] = {
      ...existing,
      evidenceIds: unique([...existing.evidenceIds, ...edge.evidenceIds]),
      confidence: Math.max(existing.confidence, edge.confidence),
      confidenceReason: incomingHasHigherConfidence ? edge.confidenceReason : existing.confidenceReason,
    };
  }
}

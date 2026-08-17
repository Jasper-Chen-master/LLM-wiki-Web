import type { DocumentRecord, Evidence, ProjectSnapshot, WikiEdge, WikiNode } from "../../shared/contracts.js";

type SafeEvidence = Pick<Evidence, "id" | "documentId" | "page" | "section" | "blockId" | "status">;
type ContextNode = Pick<WikiNode, "id" | "canonicalName" | "displayName" | "type" | "aliases" | "summary" | "properties" | "importance" | "confidence" | "evidenceIds">;
type ContextEdge = Pick<WikiEdge, "id" | "sourceNodeId" | "targetNodeId" | "relationType" | "confidence" | "relationStatus" | "evidenceIds">;

export interface WikiCatalogEntry {
  id: string;
  name: string;
  aliases: string[];
  type: string;
  summary: string;
  importance: number;
}

export interface WikiChatContext {
  wikiRevision: number;
  allowedNodeIds: string[];
  allowedEvidenceIds: string[];
  nodes: ContextNode[];
  edges: ContextEdge[];
  evidence: SafeEvidence[];
  documents: Array<Pick<DocumentRecord, "id" | "fileName">>;
  modelContext: {
    researchGoal: string;
    wikiRevision: number;
    nodes: ContextNode[];
    edges: ContextEdge[];
    evidence: SafeEvidence[];
  };
}

const unique = <T>(values: T[]) => [...new Set(values)];

/** A compact, Wiki-only catalog used before every chat answer to identify relevant topics. */
export function wikiNodeCatalog(snapshot: ProjectSnapshot): WikiCatalogEntry[] {
  return [...snapshot.nodes]
    .sort((a, b) => b.importance - a.importance || b.confidence - a.confidence)
    .slice(0, 160)
    .map(node => ({
      id: node.id,
      name: node.displayName,
      aliases: node.aliases.slice(0, 8),
      type: node.type,
      summary: node.summary.slice(0, 280),
      importance: node.importance,
    }));
}

/**
 * Some providers preserve only the stable hash suffix of a long project-scoped node ID. Resolve
 * that suffix only within this snapshot, so it remains both convenient for the model and scoped.
 */
export function resolveWikiNodeIds(snapshot: ProjectSnapshot, requestedIds: string[]): string[] {
  const exact = new Set(snapshot.nodes.map(node => node.id));
  return unique(requestedIds.flatMap(requestedId => {
    if (exact.has(requestedId)) return [requestedId];
    const matches = snapshot.nodes.filter(node => node.id.endsWith(`:node:${requestedId}`));
    return matches.length === 1 ? [matches[0].id] : [];
  }));
}

/**
 * Materializes a bounded answer context from AI-selected Wiki node IDs. It deliberately never
 * reads DocumentBlock data or Evidence.originalText; raw documents stay outside chat.
 */
export function retrieveWikiChatContextForNodeIds(snapshot: ProjectSnapshot, seedNodeIds: string[]): WikiChatContext | undefined {
  const availableIds = new Set(snapshot.nodes.map(node => node.id));
  const orderedSeeds = unique(seedNodeIds.filter(id => availableIds.has(id))).slice(0, 8);
  if (!orderedSeeds.length) return undefined;

  const selectedIds = new Set(orderedSeeds);
  const edges = snapshot.edges
    .filter(edge => selectedIds.has(edge.sourceNodeId) || selectedIds.has(edge.targetNodeId))
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 12);
  for (const edge of edges) {
    selectedIds.add(edge.sourceNodeId);
    selectedIds.add(edge.targetNodeId);
  }
  const orderedNodeIds = unique([
    ...orderedSeeds,
    ...snapshot.nodes.filter(node => selectedIds.has(node.id) && !orderedSeeds.includes(node.id)).map(node => node.id),
  ]).slice(0, 12);
  const nodes = orderedNodeIds
    .map(id => snapshot.nodes.find(node => node.id === id))
    .filter((node): node is WikiNode => Boolean(node))
    .map(node => ({
      id: node.id, canonicalName: node.canonicalName, displayName: node.displayName, type: node.type,
      aliases: node.aliases.slice(0, 8), summary: node.summary.slice(0, 900),
      properties: Object.fromEntries(Object.entries(node.properties).slice(0, 16)), importance: node.importance,
      confidence: node.confidence, evidenceIds: node.evidenceIds,
    }));
  const evidenceIds = unique([...nodes.flatMap(node => node.evidenceIds), ...edges.flatMap(edge => edge.evidenceIds)]);
  const evidence = snapshot.evidence
    .filter(item => evidenceIds.includes(item.id))
    .slice(0, 36)
    .map(item => ({ id: item.id, documentId: item.documentId, page: item.page, section: item.section, blockId: item.blockId, status: item.status }));
  const allowedEvidenceIds = evidence.map(item => item.id);
  const safeNodes = nodes
    .map(node => ({ ...node, evidenceIds: node.evidenceIds.filter(id => allowedEvidenceIds.includes(id)) }))
    .filter(node => node.evidenceIds.length > 0);
  const safeNodeIds = new Set(safeNodes.map(node => node.id));
  const safeEdges = edges
    .filter(edge => safeNodeIds.has(edge.sourceNodeId) && safeNodeIds.has(edge.targetNodeId))
    .map(edge => ({
      id: edge.id, sourceNodeId: edge.sourceNodeId, targetNodeId: edge.targetNodeId, relationType: edge.relationType,
      confidence: edge.confidence, relationStatus: edge.relationStatus, evidenceIds: edge.evidenceIds.filter(id => allowedEvidenceIds.includes(id)),
    }))
    .filter(edge => edge.evidenceIds.length > 0);
  const modelContext = {
    researchGoal: snapshot.project.profile?.researchGoal ?? snapshot.project.name,
    wikiRevision: snapshot.project.wikiRevision ?? 0,
    nodes: safeNodes,
    edges: safeEdges,
    evidence,
  };
  return {
    wikiRevision: snapshot.project.wikiRevision ?? 0,
    allowedNodeIds: safeNodes.map(node => node.id),
    allowedEvidenceIds,
    nodes: safeNodes,
    edges: safeEdges,
    evidence,
    documents: snapshot.documents.map(doc => ({ id: doc.id, fileName: doc.fileName })),
    modelContext,
  };
}

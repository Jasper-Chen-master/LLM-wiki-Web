import type { Evidence, SearchResult, WikiEdge, WikiNode } from "../../shared/contracts.js";

export interface GraphSearchFilters { nodeTypes?: string[]; relationTypes?: string[]; limit?: number; }

const normalise = (value: string) => value.toLocaleLowerCase().trim();
const evidenceFor = (nodes: WikiNode[], edges: WikiEdge[], evidence: Evidence[]) => {
  const ids = new Set([...nodes.flatMap(node => node.evidenceIds), ...edges.flatMap(edge => edge.evidenceIds)]);
  return evidence.filter(item => ids.has(item.id));
};

/** Keyword retrieval over structured knowledge; raw source text is searched through bound evidence. */
export function searchKnowledge(query: string, nodes: WikiNode[], edges: WikiEdge[], evidence: Evidence[], filters: GraphSearchFilters = {}): SearchResult {
  const terms = normalise(query).split(/\s+/).filter(Boolean);
  const allowedTypes = filters.nodeTypes?.map(normalise);
  const allowedRelations = filters.relationTypes?.map(normalise);
  const matches = (value: string) => !terms.length || terms.every(term => normalise(value).includes(term));
  const matchingEvidenceIds = new Set(evidence.filter(item => matches(item.originalText)).map(item => item.id));
  const foundNodes = nodes.filter(node => (!allowedTypes || allowedTypes.includes(normalise(node.type))) &&
    (matches([node.canonicalName, node.displayName, node.summary, ...node.aliases, ...Object.values(node.properties).map(String)].join(" ")) || node.evidenceIds.some(id => matchingEvidenceIds.has(id))));
  const nodeIds = new Set(foundNodes.map(node => node.id));
  const foundEdges = edges.filter(edge => (!allowedRelations || allowedRelations.includes(normalise(edge.relationType))) &&
    (nodeIds.has(edge.sourceNodeId) || nodeIds.has(edge.targetNodeId) || matches(edge.relationType)));
  const limit = Math.max(1, filters.limit ?? 100);
  const limitedNodes = foundNodes.slice(0, limit);
  const limitedNodeIds = new Set(limitedNodes.map(node => node.id));
  const limitedEdges = foundEdges.filter(edge => limitedNodeIds.has(edge.sourceNodeId) || limitedNodeIds.has(edge.targetNodeId)).slice(0, limit);
  return { nodes: limitedNodes, edges: limitedEdges, evidence: evidenceFor(limitedNodes, limitedEdges, evidence) };
}

export function findNeighbors(nodeId: string, nodes: WikiNode[], edges: WikiEdge[], evidence: Evidence[], filters: GraphSearchFilters = {}): SearchResult {
  const allowedRelations = filters.relationTypes?.map(normalise);
  const selectedEdges = edges.filter(edge => (edge.sourceNodeId === nodeId || edge.targetNodeId === nodeId) && (!allowedRelations || allowedRelations.includes(normalise(edge.relationType))));
  const ids = new Set([nodeId, ...selectedEdges.flatMap(edge => [edge.sourceNodeId, edge.targetNodeId])]);
  const selectedNodes = nodes.filter(node => ids.has(node.id) && (!filters.nodeTypes || filters.nodeTypes.map(normalise).includes(normalise(node.type))));
  return { nodes: selectedNodes, edges: selectedEdges, evidence: evidenceFor(selectedNodes, selectedEdges, evidence) };
}

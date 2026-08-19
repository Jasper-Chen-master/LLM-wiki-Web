import type { EvidenceClaim, EvidenceClaimCoverage, ProjectSnapshot, SearchResult, WikiEdge, WikiNode } from "../../shared/contracts.js";

export type ExportableKnowledge = Pick<ProjectSnapshot,
  "project" | "documents" | "nodes" | "edges" | "evidence" | "evidenceClaims" | "evidenceClaimCoverage"
> | SearchResult;
const csvCell = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;

/** Stable structured export, retaining evidence IDs so provenance remains navigable outside the UI. */
export function exportKnowledgeJson(data: ExportableKnowledge): string { return JSON.stringify(data, null, 2); }

export function exportKnowledgeCsv(data: ExportableKnowledge): string {
  const nodes = data.nodes as WikiNode[];
  const edges = data.edges as WikiEdge[];
  const evidence = data.evidence;
  const evidenceClaims: EvidenceClaim[] = "evidenceClaims" in data ? data.evidenceClaims ?? [] : [];
  const claimCoverage: EvidenceClaimCoverage[] = "evidenceClaimCoverage" in data ? data.evidenceClaimCoverage ?? [] : [];
  const rows: string[][] = [["record_type", "id", "name_or_relation", "type", "source_node_id", "target_node_id", "summary_or_text", "confidence", "status", "evidence_ids", "properties", "document_id", "page", "block_id"]];
  for (const node of nodes) rows.push(["node", node.id, node.displayName, node.type, "", "", node.summary, String(node.confidence), "", node.evidenceIds.join(";"), JSON.stringify(node.properties), "", "", ""]);
  for (const edge of edges) rows.push(["edge", edge.id, edge.relationType, "", edge.sourceNodeId, edge.targetNodeId, "", String(edge.confidence), edge.relationStatus, edge.evidenceIds.join(";"), "", "", "", ""]);
  for (const item of evidence) rows.push(["evidence", item.id, "", "", "", "", item.originalText, "", item.status, "", "", item.documentId, String(item.page), item.blockId]);
  for (const claim of evidenceClaims) rows.push(["evidence_claim", claim.id, claim.suggestedName ?? "", claim.suggestedType ?? claim.kind, "", "", claim.statement, String(claim.confidence), claim.disposition, claim.id, JSON.stringify({ aliases: claim.aliases, properties: claim.properties, scope: claim.scope, reason: claim.reason, catalogAction: claim.catalogAction, catalogCandidateName: claim.catalogCandidateName }), "", "", claim.blockId]);
  for (const coverage of claimCoverage) rows.push(["claim_coverage", coverage.id, "", "", "", "", coverage.reason, "", coverage.status, coverage.claimIds.join(";"), "", "", "", coverage.blockId]);
  return rows.map(row => row.map(csvCell).join(",")).join("\n");
}

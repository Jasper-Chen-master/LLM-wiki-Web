import { createHash } from "node:crypto";
import type {
  CandidateCatalogGroupProposal, CandidateCatalogOutput, DocumentBlock, EvidenceClaim,
  EvidenceClaimCoverage, SemanticResolutionAction, WikiGenerationPlan,
} from "../../shared/contracts.js";
import type { EvidenceClaimExtraction } from "../ai/provider.js";
import type { ExtractedEntity } from "./graph-service.js";
import { normalizeEntityName } from "./graph-service.js";

const unique = <T>(values: T[]) => [...new Set(values)];
const hash = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 20);

const safeType = (plan: WikiGenerationPlan, value?: string) =>
  plan.categories.find(category => category.label === value)?.label ?? plan.categories[0].label;

export function materializeEvidenceClaimLedger(input: {
  projectId: string;
  ontologyRevision: number;
  blocks: DocumentBlock[];
  extraction: EvidenceClaimExtraction;
  now?: string;
}): { claims: EvidenceClaim[]; coverage: EvidenceClaimCoverage[] } {
  const now = input.now ?? new Date().toISOString();
  const validBlockIds = new Set(input.blocks.map(block => block.id));
  const claims: EvidenceClaim[] = [];
  const claimIdsByBlock = new Map<string, string[]>();
  const occurrenceByBlock = new Map<string, number>();

  // Providers may return an otherwise identical set in a different array order. Sort before
  // assigning the per-block occurrence so stable claims keep stable IDs across reruns.
  const orderedDrafts = [...input.extraction.claims].sort((left, right) => (
    left.blockId.localeCompare(right.blockId)
    || left.kind.localeCompare(right.kind)
    || left.statement.localeCompare(right.statement)
    || (left.suggestedName ?? "").localeCompare(right.suggestedName ?? "")
    || left.disposition.localeCompare(right.disposition)
  ));
  for (const draft of orderedDrafts) {
    if (!validBlockIds.has(draft.blockId)) continue;
    const occurrence = occurrenceByBlock.get(draft.blockId) ?? 0;
    occurrenceByBlock.set(draft.blockId, occurrence + 1);
    const catalogable = draft.disposition === "ignore" || Boolean(draft.suggestedName?.trim());
    const disposition = catalogable ? draft.disposition : "ignore" as const;
    const reason = catalogable ? draft.reason : "A candidate or attach claim lacked its required suggestedName and was retained only as an ignored audit record.";
    const id = `${input.projectId}:claim:${hash(`${draft.blockId}|${occurrence}|${draft.kind}|${draft.statement}`)}`;
    const claim: EvidenceClaim = {
      id, projectId: input.projectId, ontologyRevision: input.ontologyRevision, blockId: draft.blockId,
      disposition, kind: draft.kind, statement: draft.statement,
      suggestedName: draft.suggestedName?.trim(), suggestedType: draft.suggestedType?.trim(),
      aliases: unique(draft.aliases), properties: draft.properties, scope: draft.scope,
      importance: draft.importance, confidence: draft.confidence, reason, createdAt: now,
    };
    claims.push(claim);
    claimIdsByBlock.set(claim.blockId, [...(claimIdsByBlock.get(claim.blockId) ?? []), id]);
  }

  const draftCoverageByBlock = new Map<string, EvidenceClaimExtraction["coverage"][number]>();
  for (const draft of input.extraction.coverage) {
    if (validBlockIds.has(draft.blockId) && !draftCoverageByBlock.has(draft.blockId)) draftCoverageByBlock.set(draft.blockId, draft);
  }
  const coverage = input.blocks.map(block => {
    const draft = draftCoverageByBlock.get(block.id);
    const claimIds = claimIdsByBlock.get(block.id) ?? [];
    const catalogableClaims = claims.filter(claim => claim.blockId === block.id && claim.disposition !== "ignore");
    const status = !draft
      ? "unresolved" as const
      : draft.status === "claimed" && !catalogableClaims.length
        ? "unresolved" as const
        : draft.status;
    const reason = !draft
      ? "The model omitted this required block coverage decision."
      : draft.status === "claimed" && !catalogableClaims.length
        ? "The model marked this block claimed but returned no catalogable claim."
        : draft.reason;
    return {
      id: `${input.projectId}:claim-coverage:${hash(block.id)}`,
      projectId: input.projectId, ontologyRevision: input.ontologyRevision, blockId: block.id,
      status, reason, claimIds, createdAt: now,
    } satisfies EvidenceClaimCoverage;
  });
  return { claims, coverage };
}

export function materializeCandidateCatalog(input: {
  projectId: string;
  plan: WikiGenerationPlan;
  claims: EvidenceClaim[];
  proposal: CandidateCatalogOutput;
}): {
  entities: ExtractedEntity[];
  claims: EvidenceClaim[];
  canonicalNameByClaimName: Map<string, string>;
} {
  const claimById = new Map(input.claims
    .filter(claim => claim.disposition !== "ignore" && claim.suggestedName)
    .map(claim => [claim.id, claim]));
  const assigned = new Set<string>();
  const groups: Array<{ proposal: CandidateCatalogGroupProposal; claims: EvidenceClaim[]; source: "ai" | "fallback" }> = [];

  const fallback = (claim: EvidenceClaim) => groups.push({
    proposal: {
      canonicalClaimId: claim.id,
      canonicalName: claim.suggestedName ?? claim.statement.slice(0, 160),
      canonicalType: safeType(input.plan, claim.suggestedType), canonicalSummary: claim.statement,
      members: [{ claimId: claim.id, action: "keep_separate", scope: claim.scope, reason: "The claim was not safely covered by a global catalog group." }],
      importance: claim.importance, confidence: claim.confidence,
      reason: "Safe fallback preserved this evidence claim as its own preliminary candidate.",
    },
    claims: [claim], source: "fallback",
  });

  for (const proposal of input.proposal.groups) {
    const memberProposals = proposal.members.filter(member => claimById.has(member.claimId) && !assigned.has(member.claimId));
    const canonical = claimById.get(proposal.canonicalClaimId);
    if (!canonical || assigned.has(canonical.id) || !memberProposals.some(member => member.claimId === canonical.id)) continue;
    if (proposal.confidence < .72) {
      for (const member of memberProposals) {
        const claim = claimById.get(member.claimId)!;
        assigned.add(claim.id);
        fallback(claim);
      }
      continue;
    }
    const mergedMembers = memberProposals.filter(member => member.claimId === canonical.id || !["keep_separate", "uncertain"].includes(member.action));
    if (!mergedMembers.length) continue;
    const memberIds = new Set(mergedMembers.map(member => member.claimId));
    const memberClaims = [...memberIds].map(id => claimById.get(id)!);
    for (const claim of memberClaims) assigned.add(claim.id);
    groups.push({ proposal: { ...proposal, members: mergedMembers }, claims: memberClaims, source: "ai" });
    for (const member of memberProposals.filter(member => !memberIds.has(member.claimId))) {
      const claim = claimById.get(member.claimId)!;
      assigned.add(claim.id);
      fallback(claim);
    }
  }
  for (const claim of claimById.values()) if (!assigned.has(claim.id)) fallback(claim);

  const entities: ExtractedEntity[] = [];
  const claimUpdates = new Map(input.claims.map(claim => [claim.id, claim]));
  const canonicalNameByClaimName = new Map<string, string>();
  for (const group of groups) {
    const canonical = claimById.get(group.proposal.canonicalClaimId) ?? group.claims[0];
    const canonicalName = group.proposal.canonicalName;
    const memberProposalById = new Map(group.proposal.members.map(member => [member.claimId, member]));
    for (const claim of group.claims) {
      const member = memberProposalById.get(claim.id);
      claimUpdates.set(claim.id, {
        ...claim,
        catalogCandidateName: canonicalName,
        catalogAction: member?.action ?? "keep_separate",
      });
      for (const name of [claim.suggestedName, ...claim.aliases]) {
        if (name) canonicalNameByClaimName.set(normalizeEntityName(name), canonicalName);
      }
    }
    const properties: Record<string, string | number> = {};
    for (const claim of group.claims) for (const [key, value] of Object.entries(claim.properties)) if (!(key in properties)) properties[key] = value;
    entities.push({
      name: canonicalName, canonicalName, type: safeType(input.plan, group.proposal.canonicalType),
      aliases: unique(group.claims.flatMap(claim => [claim.suggestedName, ...claim.aliases].filter((value): value is string => Boolean(value))))
        .filter(name => normalizeEntityName(name) !== normalizeEntityName(canonicalName)),
      summary: group.proposal.canonicalSummary || canonical.statement,
      properties, importance: Math.max(...group.claims.map(claim => claim.importance)),
      importanceReason: group.proposal.reason,
      confidence: Math.max(group.proposal.confidence, ...group.claims.map(claim => claim.confidence)),
      confidenceReason: group.proposal.reason,
      evidenceIds: unique(group.claims.map(claim => claim.blockId)).sort(),
      claimIds: group.claims.map(claim => claim.id),
    });
  }
  return { entities, claims: [...claimUpdates.values()], canonicalNameByClaimName };
}

export function mergeEvidenceClaims(existing: EvidenceClaim[], incoming: EvidenceClaim[]): EvidenceClaim[] {
  const byId = new Map(existing.map(claim => [claim.id, claim]));
  for (const claim of incoming) byId.set(claim.id, claim);
  return [...byId.values()];
}

export function mergeEvidenceClaimCoverage(existing: EvidenceClaimCoverage[], incoming: EvidenceClaimCoverage[]): EvidenceClaimCoverage[] {
  const byId = new Map(existing.map(coverage => [coverage.id, coverage]));
  for (const coverage of incoming) byId.set(coverage.id, coverage);
  return [...byId.values()];
}

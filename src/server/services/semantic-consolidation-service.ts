import { createHash } from "node:crypto";
import type {
  ConceptRegistryEntry, KnowledgeCandidate, SemanticConsolidationOutput, SemanticResolution,
  SemanticResolutionGroupProposal, WikiGenerationPlan, WikiSemanticMember, WikiSummaryOutput,
} from "../../shared/contracts.js";
import type { ExtractedEntity, ExtractedRelation } from "./graph-service.js";
import { normalizeEntityName } from "./graph-service.js";

const unique = <T>(values: T[]) => [...new Set(values)];
const hash = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 20);

function mergeProperties(candidates: KnowledgeCandidate[], canonical: KnowledgeCandidate) {
  const properties = { ...canonical.properties };
  for (const candidate of candidates) {
    for (const [key, value] of Object.entries(candidate.properties)) {
      if (!(key in properties)) properties[key] = value;
    }
  }
  return properties;
}

function safeType(plan: WikiGenerationPlan, proposed: string, fallback?: string) {
  return plan.categories.find(category => category.label === proposed)?.label
    ?? plan.categories.find(category => category.label === fallback)?.label
    ?? plan.categories[0].label;
}

export function materializeSemanticConsolidation(input: {
  projectId: string;
  ontologyRevision: number;
  plan: WikiGenerationPlan;
  candidates: KnowledgeCandidate[];
  proposal: SemanticConsolidationOutput;
  existingRegistry: ConceptRegistryEntry[];
  now?: string;
}): {
  resolutions: SemanticResolution[];
  registryEntries: ConceptRegistryEntry[];
  consolidatedEntities: ExtractedEntity[];
  canonicalNameByCandidateName: Map<string, string>;
} {
  const now = input.now ?? new Date().toISOString();
  const candidateById = new Map(input.candidates.filter(candidate => candidate.decision !== "ignore").map(candidate => [candidate.id, candidate]));
  const registryById = new Map(input.existingRegistry
    .filter(entry => entry.projectId === input.projectId && entry.status !== "orphaned")
    .map(entry => [entry.id, entry]));
  const assigned = new Set<string>();
  const acceptedGroups: Array<{ proposal: SemanticResolutionGroupProposal; members: KnowledgeCandidate[]; source: "ai" | "fallback" }> = [];

  const addFallback = (candidate: KnowledgeCandidate) => acceptedGroups.push({
    proposal: {
      canonicalCandidateId: candidate.id,
      canonicalName: candidate.canonicalName ?? candidate.name,
      canonicalType: safeType(input.plan, candidate.proposedType ?? ""),
      canonicalSummary: candidate.summary || candidate.name,
      members: [{ candidateId: candidate.id, action: "keep_separate", reason: "The candidate was not safely covered by an AI consolidation group." }],
      confidence: 1,
      reason: "Safe fallback preserved this evidence-backed candidate as a separate concept.",
    },
    members: [candidate],
    source: "fallback",
  });

  for (const group of input.proposal.groups) {
    const memberProposals = group.members.filter(member => candidateById.has(member.candidateId) && !assigned.has(member.candidateId));
    const canonical = candidateById.get(group.canonicalCandidateId);
    if (!canonical || assigned.has(canonical.id) || !memberProposals.some(member => member.candidateId === canonical.id)) continue;
    const mergeable = memberProposals.filter(member => member.candidateId === canonical.id
      || !["keep_separate", "uncertain"].includes(member.action));
    const shouldSplit = group.confidence < .72 || mergeable.length < 1;
    if (shouldSplit) {
      for (const member of memberProposals) {
        const candidate = candidateById.get(member.candidateId)!;
        assigned.add(candidate.id);
        addFallback(candidate);
      }
      continue;
    }
    const mergeableIds = new Set(mergeable.map(member => member.candidateId));
    const members = [...mergeableIds].map(id => candidateById.get(id)!);
    for (const member of members) assigned.add(member.id);
    acceptedGroups.push({
      proposal: { ...group, members: memberProposals.filter(member => mergeableIds.has(member.candidateId)) },
      members,
      source: "ai",
    });
    for (const member of memberProposals.filter(member => !mergeableIds.has(member.candidateId))) {
      const candidate = candidateById.get(member.candidateId)!;
      assigned.add(candidate.id);
      addFallback(candidate);
    }
  }
  for (const candidate of candidateById.values()) if (!assigned.has(candidate.id)) addFallback(candidate);

  const resolutions: SemanticResolution[] = [];
  const registryEntries: ConceptRegistryEntry[] = [];
  const consolidatedEntities: ExtractedEntity[] = [];
  const canonicalNameByCandidateName = new Map<string, string>();

  for (const group of acceptedGroups) {
    const canonical = candidateById.get(group.proposal.canonicalCandidateId) ?? group.members[0];
    const existing = group.proposal.registryEntryId ? registryById.get(group.proposal.registryEntryId) : undefined;
    const registryEntryId = existing?.id ?? `${input.projectId}:concept:${hash(canonical.canonicalKey)}`;
    const canonicalName = existing?.canonicalName ?? group.proposal.canonicalName;
    const canonicalType = existing?.type ?? safeType(input.plan, group.proposal.canonicalType, canonical.proposedType);
    const canonicalSummary = group.proposal.canonicalSummary || existing?.summary || canonical.summary || canonicalName;
    const proposalMemberById = new Map(group.proposal.members.map(member => [member.candidateId, member]));
    const semanticMembers: WikiSemanticMember[] = group.members.map(candidate => {
      const proposed = proposalMemberById.get(candidate.id);
      return {
        candidateId: candidate.id,
        name: candidate.canonicalName ?? candidate.name,
        action: proposed?.action ?? "keep_separate",
        scope: proposed?.scope,
        conditions: proposed?.conditions,
        reason: proposed?.reason ?? "Preserved as the canonical member.",
      };
    });
    const aliases = unique([
      ...(existing?.aliases ?? []),
      ...group.members.flatMap(candidate => [candidate.name, candidate.canonicalName, ...candidate.aliases].filter((value): value is string => Boolean(value))),
    ]).filter(alias => normalizeEntityName(alias) !== normalizeEntityName(canonicalName));
    const evidenceBlockIds = unique([...(existing?.evidenceBlockIds ?? []), ...group.members.flatMap(candidate => candidate.evidenceBlockIds)]).sort();
    const confidence = Math.max(existing?.confidence ?? 0, group.proposal.confidence);
    const status = group.source === "ai" && group.proposal.confidence < .82 ? "needs_review" as const : "active" as const;
    const registryEntry: ConceptRegistryEntry = {
      id: registryEntryId,
      projectId: input.projectId,
      ontologyRevision: input.ontologyRevision,
      canonicalName,
      displayName: canonicalName,
      type: canonicalType,
      aliases,
      summary: canonicalSummary,
      memberCandidateIds: unique([...(existing?.memberCandidateIds ?? []), ...group.members.map(candidate => candidate.id)]),
      claimIds: unique([...(existing?.claimIds ?? []), ...group.members.flatMap(candidate => candidate.claimIds ?? [])]),
      evidenceBlockIds,
      semanticMembers: [...new Map([...(existing?.semanticMembers ?? []), ...semanticMembers].map(member => [member.candidateId, member])).values()],
      confidence,
      status,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    registryEntries.push(registryEntry);
    resolutions.push({
      id: `${input.projectId}:resolution:${hash(`${input.ontologyRevision}|${registryEntryId}|${group.members.map(candidate => candidate.id).sort().join("|")}`)}`,
      projectId: input.projectId,
      ontologyRevision: input.ontologyRevision,
      registryEntryId,
      canonicalCandidateId: canonical.id,
      canonicalName,
      canonicalType,
      canonicalSummary,
      members: semanticMembers,
      confidence: group.proposal.confidence,
      reason: group.proposal.reason,
      status: status === "active" ? "accepted" : "needs_review",
      source: group.source,
      createdAt: now,
    });
    consolidatedEntities.push({
      name: canonicalName,
      canonicalName,
      type: canonicalType,
      aliases,
      summary: canonicalSummary,
      properties: mergeProperties(group.members, canonical),
      importance: Math.max(...group.members.map(candidate => candidate.score.userRelevance)),
      importanceReason: canonical.importanceReason,
      confidence,
      confidenceReason: canonical.confidenceReason ?? group.proposal.reason,
      evidenceIds: evidenceBlockIds,
      classification: canonical.classification,
      registryEntryId,
      semanticMembers,
    });
    for (const candidate of group.members) {
      for (const name of [candidate.name, candidate.canonicalName, ...candidate.aliases]) {
        if (name) canonicalNameByCandidateName.set(normalizeEntityName(name), canonicalName);
      }
    }
  }
  return { resolutions, registryEntries, consolidatedEntities, canonicalNameByCandidateName };
}

export function rewriteRelationsWithSemanticMap(
  relations: ExtractedRelation[],
  canonicalNameByCandidateName: Map<string, string>,
): ExtractedRelation[] {
  return relations.map(relation => ({
    ...relation,
    source: canonicalNameByCandidateName.get(normalizeEntityName(relation.source)) ?? relation.source,
    target: canonicalNameByCandidateName.get(normalizeEntityName(relation.target)) ?? relation.target,
  }));
}

export function mergeConceptRegistry(
  existing: ConceptRegistryEntry[],
  incoming: ConceptRegistryEntry[],
): ConceptRegistryEntry[] {
  const byId = new Map(existing.map(entry => [entry.id, entry]));
  for (const entry of incoming) {
    const previous = byId.get(entry.id);
    if (!previous) { byId.set(entry.id, entry); continue; }
    const incomingIsStronger = entry.confidence >= previous.confidence;
    byId.set(entry.id, {
      ...(incomingIsStronger ? previous : entry),
      ...(incomingIsStronger ? entry : previous),
      aliases: unique([...previous.aliases, ...entry.aliases]),
      memberCandidateIds: unique([...previous.memberCandidateIds, ...entry.memberCandidateIds]),
      claimIds: unique([...(previous.claimIds ?? []), ...(entry.claimIds ?? [])]),
      evidenceBlockIds: unique([...previous.evidenceBlockIds, ...entry.evidenceBlockIds]).sort(),
      semanticMembers: [...new Map([...previous.semanticMembers, ...entry.semanticMembers]
        .map(member => [member.candidateId, member])).values()],
      confidence: Math.max(previous.confidence, entry.confidence),
      status: previous.status === "active" || entry.status === "active" ? "active" : entry.status,
      createdAt: previous.createdAt,
      updatedAt: entry.updatedAt,
    });
  }
  return [...byId.values()];
}

const sameSet = (left: string[] | undefined, right: string[] | undefined) => {
  const leftSet = new Set(left ?? []);
  const rightSet = new Set(right ?? []);
  return leftSet.size === rightSet.size && [...leftSet].every(value => rightSet.has(value));
};

/** Reuses stable prose when the underlying canonical evidence is unchanged. New or changed
 * evidence may receive an AI-written summary, but an unrelated rebuild cannot rewrite a page. */
export function applyStableConceptSummaries(input: {
  existingRegistry: ConceptRegistryEntry[];
  registryEntries: ConceptRegistryEntry[];
  consolidatedEntities: ExtractedEntity[];
  summaries: WikiSummaryOutput;
}): { registryEntries: ConceptRegistryEntry[]; consolidatedEntities: ExtractedEntity[]; entriesNeedingSummary: ConceptRegistryEntry[] } {
  const existingById = new Map(input.existingRegistry.map(entry => [entry.id, entry]));
  const summaryById = new Map(input.summaries.summaries.map(summary => [summary.registryEntryId, summary]));
  const entriesNeedingSummary: ConceptRegistryEntry[] = [];
  const summaryByRegistryId = new Map<string, string>();
  const registryEntries = input.registryEntries.map(entry => {
    const existing = existingById.get(entry.id);
    const unchanged = Boolean(existing
      && sameSet(existing.evidenceBlockIds, entry.evidenceBlockIds)
      && sameSet(existing.claimIds, entry.claimIds)
      && sameSet(existing.memberCandidateIds, entry.memberCandidateIds));
    if (unchanged && existing) {
      summaryByRegistryId.set(entry.id, existing.summary);
      return { ...entry, summary: existing.summary, updatedAt: existing.updatedAt };
    }
    entriesNeedingSummary.push(entry);
    const generated = summaryById.get(entry.id);
    const summary = generated?.summary || entry.summary;
    summaryByRegistryId.set(entry.id, summary);
    return { ...entry, summary };
  });
  return {
    registryEntries,
    consolidatedEntities: input.consolidatedEntities.map(entity => ({
      ...entity,
      summary: entity.registryEntryId ? summaryByRegistryId.get(entity.registryEntryId) ?? entity.summary : entity.summary,
    })),
    entriesNeedingSummary,
  };
}

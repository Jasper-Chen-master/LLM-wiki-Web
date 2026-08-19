import { createHash } from "node:crypto";
import type {
  DocumentBlock, KnowledgeCandidate, NodeCreationPolicy, WikiGenerationPlan, WikiProfile,
} from "../../shared/contracts.js";
import type { ExtractedEntity } from "./graph-service.js";
import { normalizeEntityName } from "./graph-service.js";

const clamp = (value: number) => Math.max(0, Math.min(1, value));
const rounded = (value: number) => Math.round(value * 10_000) / 10_000;
const unique = <T>(values: T[]) => [...new Set(values)];

export function nodeCreationPolicyFor(profile: WikiProfile, plan: WikiGenerationPlan): NodeCreationPolicy {
  if (plan.nodeCreationPolicy) return plan.nodeCreationPolicy;
  const thresholds = profile.qualityPreference === "precision_first"
    ? { publishThreshold: .68, reviewThreshold: .42 }
    : profile.qualityPreference === "recall_first"
      ? { publishThreshold: .48, reviewThreshold: .28 }
      : { publishThreshold: .58, reviewThreshold: .34 };
  return {
    version: "1.0",
    ...thresholds,
    minimumEvidenceCount: 1,
    requireIndependentMeaning: true,
    retainReviewCandidates: true,
  };
}

function mergeEntityCandidates(entities: ExtractedEntity[]): ExtractedEntity[] {
  const grouped = new Map<string, ExtractedEntity>();
  for (const entity of entities) {
    const key = normalizeEntityName(entity.canonicalName ?? entity.name);
    if (!key) continue;
    const current = grouped.get(key);
    if (!current) { grouped.set(key, entity); continue; }
    const representative = (entity.summary?.length ?? 0) > (current.summary?.length ?? 0) ? entity : current;
    grouped.set(key, {
      ...representative,
      aliases: unique([...(current.aliases ?? []), ...(entity.aliases ?? [])]),
      properties: { ...(current.properties ?? {}), ...(entity.properties ?? {}) },
      evidenceIds: unique([...(current.evidenceIds ?? []), ...(entity.evidenceIds ?? [])]),
      importance: Math.max(current.importance ?? 0, entity.importance ?? 0) || undefined,
      confidence: Math.max(current.confidence ?? 0, entity.confidence ?? 0) || undefined,
      registryEntryId: representative.registryEntryId ?? current.registryEntryId ?? entity.registryEntryId,
      semanticMembers: [...new Map([...(current.semanticMembers ?? []), ...(entity.semanticMembers ?? [])]
        .map(member => [member.candidateId, member])).values()],
      claimIds: unique([...(current.claimIds ?? []), ...(entity.claimIds ?? [])]),
    });
  }
  return [...grouped.values()];
}

export function evaluateKnowledgeCandidates(input: {
  projectId: string;
  ontologyRevision: number;
  profile: WikiProfile;
  plan: WikiGenerationPlan;
  entities: ExtractedEntity[];
  blocks: DocumentBlock[];
  now?: string;
}): { candidates: KnowledgeCandidate[]; publishableEntities: ExtractedEntity[] } {
  const policy = nodeCreationPolicyFor(input.profile, input.plan);
  const blockById = new Map(input.blocks.map(block => [block.id, block]));
  const now = input.now ?? new Date().toISOString();
  const candidates: KnowledgeCandidate[] = [];
  const publishableEntities: ExtractedEntity[] = [];

  for (const entity of mergeEntityCandidates(input.entities)) {
    const canonicalKey = normalizeEntityName(entity.canonicalName ?? entity.name);
    const evidenceBlockIds = unique(entity.evidenceIds ?? []).filter(id => blockById.has(id)).sort();
    const evidenceBlocks = evidenceBlockIds.map(id => blockById.get(id)).filter((block): block is DocumentBlock => Boolean(block));
    const sourceDocumentIds = unique(evidenceBlocks.map(block => block.documentId)).sort();
    const evidenceLength = evidenceBlocks.reduce((sum, block) => sum + block.text.length, 0);
    const propertyCount = Object.keys(entity.properties ?? {}).length;
    const summaryLength = entity.summary?.trim().length ?? 0;
    const userRelevance = clamp(entity.importance ?? .6);
    const evidenceStrength = clamp(
      .35
      + .15 * Math.min(2, Math.max(0, evidenceBlocks.length - 1))
      + .2 * Math.min(1, Math.max(0, sourceDocumentIds.length - 1))
      + .3 * Math.min(1, evidenceLength / 900),
    );
    const conceptualIndependence = clamp(
      .25 + (summaryLength >= 40 ? .35 : summaryLength >= 15 ? .2 : 0)
      + (propertyCount > 0 ? .2 : 0)
      + (evidenceBlocks.length > 1 ? .1 : 0),
    );
    const structuredCompleteness = clamp(
      .25 + (summaryLength > 0 ? .3 : 0) + (propertyCount > 0 ? .25 : 0)
      + (entity.type ? .1 : 0) + ((entity.aliases?.length ?? 0) > 0 ? .1 : 0),
    );
    const total = clamp(
      .45 * userRelevance + .3 * evidenceStrength
      + .15 * conceptualIndependence + .1 * structuredCompleteness,
    );
    const enoughEvidence = evidenceBlocks.length >= policy.minimumEvidenceCount;
    const independentEnough = !policy.requireIndependentMeaning || conceptualIndependence >= .5;
    const decision = !enoughEvidence
      ? "ignore" as const
      : total >= policy.publishThreshold && independentEnough
        ? "publish_node" as const
        : total >= policy.reviewThreshold
          ? "review" as const
          : "ignore" as const;
    const decisionReason = !enoughEvidence
      ? `Missing the required ${policy.minimumEvidenceCount} valid evidence block(s).`
      : !independentEnough
        ? "The candidate is evidence-backed but does not yet demonstrate independent reusable meaning."
        : decision === "publish_node"
          ? `Eligibility score ${rounded(total)} meets the publish threshold ${policy.publishThreshold}.`
          : decision === "review"
            ? `Eligibility score ${rounded(total)} is below publish threshold ${policy.publishThreshold}; retained for review.`
            : `Eligibility score ${rounded(total)} is below review threshold ${policy.reviewThreshold}.`;
    candidates.push({
      id: `${input.projectId}:candidate:${createHash("sha256").update(canonicalKey).digest("hex").slice(0, 20)}`,
      projectId: input.projectId,
      canonicalKey,
      name: entity.name,
      canonicalName: entity.canonicalName,
      proposedType: entity.type,
      aliases: unique(entity.aliases ?? []),
      summary: entity.summary ?? "",
      properties: entity.properties ?? {},
      evidenceBlockIds,
      sourceDocumentIds,
      score: {
        userRelevance: rounded(userRelevance), evidenceStrength: rounded(evidenceStrength),
        conceptualIndependence: rounded(conceptualIndependence),
        structuredCompleteness: rounded(structuredCompleteness), total: rounded(total),
      },
      decision,
      decisionReason,
      ontologyRevision: input.ontologyRevision,
      importanceReason: entity.importanceReason,
      confidence: entity.confidence,
      confidenceReason: entity.confidenceReason,
      classification: entity.classification,
      claimIds: entity.claimIds,
      createdAt: now,
      updatedAt: now,
    });
    if (decision === "publish_node") publishableEntities.push({ ...entity, evidenceIds: evidenceBlockIds });
  }
  return { candidates, publishableEntities };
}

export function mergeKnowledgeCandidates(existing: KnowledgeCandidate[], incoming: KnowledgeCandidate[]): KnowledgeCandidate[] {
  const byId = new Map(existing.map(candidate => [candidate.id, candidate]));
  for (const candidate of incoming) {
    const previous = byId.get(candidate.id);
    byId.set(candidate.id, previous ? {
      ...candidate,
      createdAt: previous.createdAt,
      aliases: unique([...previous.aliases, ...candidate.aliases]),
      evidenceBlockIds: unique([...previous.evidenceBlockIds, ...candidate.evidenceBlockIds]).sort(),
      sourceDocumentIds: unique([...previous.sourceDocumentIds, ...candidate.sourceDocumentIds]).sort(),
      claimIds: unique([...(previous.claimIds ?? []), ...(candidate.claimIds ?? [])]),
    } : candidate);
  }
  return [...byId.values()];
}

import { createHash } from "node:crypto";
import type { OntologyExtensionProposal, WikiCategory, WikiGenerationPlan } from "../../shared/contracts.js";
import { stableJson } from "./build-manifest-service.js";

const normalized = (value: string) => value.normalize("NFKC").trim().toLocaleLowerCase();

function isExistingCategory(category: WikiCategory, base: WikiGenerationPlan): boolean {
  return base.categories.some(existing => {
    if (category.role !== "other" && existing.role === category.role) return true;
    return [existing.id, existing.label].some(left => [category.id, category.label]
      .some(right => normalized(left) === normalized(right)));
  });
}

export function createOntologyExtensionProposal(input: {
  projectId: string;
  baseOntologyRevision: number;
  basePlan: WikiGenerationPlan;
  proposedPlan: WikiGenerationPlan;
  sourceDocumentIds: string[];
  now?: string;
}): OntologyExtensionProposal | undefined {
  const categories = input.proposedPlan.categories.filter(category => !isExistingCategory(category, input.basePlan));
  const fieldLabels = new Set(input.basePlan.fieldRules.map(rule => normalized(rule.label)));
  const fieldIds = new Set(input.basePlan.fieldRules.map(rule => normalized(rule.id)));
  const fieldRules = input.proposedPlan.fieldRules.filter(rule => !fieldLabels.has(normalized(rule.label)) && !fieldIds.has(normalized(rule.id)));
  const relationLabels = new Set(input.basePlan.relationRules.map(rule => normalized(rule.label)));
  const relationIds = new Set(input.basePlan.relationRules.map(rule => normalized(rule.id)));
  const relationRules = input.proposedPlan.relationRules.filter(rule => !relationLabels.has(normalized(rule.label)) && !relationIds.has(normalized(rule.id)));
  if (!categories.length && !fieldRules.length && !relationRules.length) return undefined;
  const sourceDocumentIds = [...new Set(input.sourceDocumentIds)].sort();
  const payload = { baseOntologyRevision: input.baseOntologyRevision, sourceDocumentIds, categories, fieldRules, relationRules };
  return {
    id: `${input.projectId}:ontology-extension:${createHash("sha256").update(stableJson(payload)).digest("hex").slice(0, 20)}`,
    projectId: input.projectId,
    baseOntologyRevision: input.baseOntologyRevision,
    sourceDocumentIds,
    categories,
    fieldRules,
    relationRules,
    status: "pending",
    rationale: "New source documents suggested schema elements outside the frozen ontology. They were retained as a proposal and did not mutate the active plan.",
    createdAt: input.now ?? new Date().toISOString(),
  };
}

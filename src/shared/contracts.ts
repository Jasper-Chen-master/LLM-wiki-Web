import { z } from "zod";

export const DocumentKindSchema = z.enum(["pdf", "docx"]);
export type DocumentKind = z.infer<typeof DocumentKindSchema>;
export const JobStatusSchema = z.enum(["queued", "parsing", "analyzing", "planning", "filtering", "extracting", "resolving", "building_graph", "completed", "failed"]);
export type JobStatus = z.infer<typeof JobStatusSchema>;
export type JobBatchPhase =
  | "document_analysis" | "document_synthesis" | "plan_generation" | "relevance"
  | "claim_extraction" | "candidate_catalog" | "semantic_consolidation" | "wiki_summarization";
export interface JobBatchProgress { phase: JobBatchPhase; completed: number; total: number; elapsedSeconds: number; }

export const WikiPresetSchema = z.enum([
  "auto", "course", "research", "literature_review", "experimental", "prediction",
  "business", "policy", "technical", "personal", "general", "custom",
]);
export type WikiPreset = z.infer<typeof WikiPresetSchema>;
export const WikiQualityPreferenceSchema = z.enum(["precision_first", "balanced", "recall_first"]);
export type WikiQualityPreference = z.infer<typeof WikiQualityPreferenceSchema>;
export const WikiCostPreferenceSchema = z.enum(["economy", "balanced", "quality"]);
export type WikiCostPreference = z.infer<typeof WikiCostPreferenceSchema>;

export const WikiProfileSchema = z.object({
  version: z.literal("1.0"), researchGoal: z.string().min(1), domain: z.string().default("General research"),
  entityTypes: z.array(z.string()).default([]), importantFields: z.array(z.string()).default([]),
  preferredRelations: z.array(z.string()).default([]), exclude: z.array(z.string()).default([]),
  extractNumericData: z.boolean().default(true), preserveUnits: z.boolean().default(true), extractTables: z.boolean().default(false),
  evidenceRequired: z.boolean().default(true), notes: z.string().default(""), outputLanguage: z.enum(["en", "zh"]).optional(),
  preset: WikiPresetSchema.optional(), customRequirements: z.string().max(8_000).optional(),
  targetQuestions: z.array(z.string().trim().min(1).max(500)).max(20).optional(),
  unitOfAnalysis: z.string().trim().max(160).optional(),
  qualityPreference: WikiQualityPreferenceSchema.optional(),
  costPreference: WikiCostPreferenceSchema.optional(),
});
export type WikiProfile = z.infer<typeof WikiProfileSchema>;

export const WikiCategoryRoleSchema = z.enum(["law", "theorem", "theory", "model", "concept", "method", "formula", "quantity", "experiment", "phenomenon", "person", "material", "other"]);
export type WikiCategoryRole = z.infer<typeof WikiCategoryRoleSchema>;
export const WikiCategorySchema = z.object({
  id: z.string().trim().min(1).max(80), label: z.string().trim().min(1).max(80),
  role: WikiCategoryRoleSchema, definition: z.string().trim().min(1).max(500),
  inclusionExamples: z.array(z.string().trim().min(1).max(120)).max(12).default([]),
  exclusionExamples: z.array(z.string().trim().min(1).max(120)).max(12).default([]),
});
export type WikiCategory = z.infer<typeof WikiCategorySchema>;
export const WikiFieldPrioritySchema = z.enum(["critical", "high", "medium"]);
export const WikiFieldRuleSchema = z.object({
  id: z.string().trim().min(1).max(80), label: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(500), priority: WikiFieldPrioritySchema,
  valueType: z.enum(["text", "number", "boolean", "date", "list", "object"]),
  unitRequired: z.boolean().default(false), evidenceRequired: z.boolean().default(true),
});
export type WikiFieldRule = z.infer<typeof WikiFieldRuleSchema>;
export const WikiRelationRuleSchema = z.object({
  id: z.string().trim().min(1).max(80), label: z.string().trim().min(1).max(100),
  definition: z.string().trim().min(1).max(500),
  allowedSourceCategoryIds: z.array(z.string().trim().min(1).max(80)).max(16).default([]),
  allowedTargetCategoryIds: z.array(z.string().trim().min(1).max(80)).max(16).default([]),
  symmetric: z.boolean().default(false), requiresConditions: z.boolean().default(false),
  allowInferred: z.boolean().default(false),
});
export type WikiRelationRule = z.infer<typeof WikiRelationRuleSchema>;
export const WikiQualityPolicySchema = z.object({
  relevanceThreshold: z.number().min(0).max(1), entityThreshold: z.number().min(0).max(1),
  relationThreshold: z.number().min(0).max(1), criticalCoverageTarget: z.number().min(0).max(1),
  maximumGenericRelationRatio: z.number().min(0).max(1),
});
export type WikiQualityPolicy = z.infer<typeof WikiQualityPolicySchema>;
export const NodeCreationPolicySchema = z.object({
  version: z.literal("1.0"),
  publishThreshold: z.number().min(0).max(1),
  reviewThreshold: z.number().min(0).max(1),
  minimumEvidenceCount: z.number().int().min(1).max(20),
  requireIndependentMeaning: z.boolean(),
  retainReviewCandidates: z.boolean(),
});
export type NodeCreationPolicy = z.infer<typeof NodeCreationPolicySchema>;
export const CandidateExtractionContractSchema = z.object({
  version: z.literal("1.0"),
  analysisUnit: z.string().trim().min(1).max(240),
  atomicityRules: z.array(z.string().trim().min(1).max(500)).min(2).max(12),
  attachInsteadOfCreateRules: z.array(z.string().trim().min(1).max(500)).min(1).max(12),
  exclusionRules: z.array(z.string().trim().min(1).max(500)).max(12).default([]),
  requiredClaimKinds: z.array(z.string().trim().min(1).max(80)).max(16).default([]),
  requireBlockCoverage: z.boolean().default(true),
});
export type CandidateExtractionContract = z.infer<typeof CandidateExtractionContractSchema>;
export const WikiGenerationPlanSchema = z.object({
  version: z.enum(["1.0", "2.0"]), outputLanguage: z.enum(["en", "zh"]), researchGoal: z.string().trim().min(1).max(1_000),
  corpusSummary: z.string().trim().min(1).max(2_000), themes: z.array(z.string().trim().min(1).max(160)).max(24),
  requiredKnowledge: z.array(z.string().trim().min(1).max(240)).max(24),
  categories: z.array(WikiCategorySchema).min(1).max(16),
  relationTypes: z.array(z.string().trim().min(1).max(100)).max(24),
  classificationRules: z.array(z.string().trim().min(1).max(320)).max(30),
  detectedPreset: WikiPresetSchema.default("auto"),
  unitOfAnalysis: z.string().trim().max(160).default(""),
  targetQuestions: z.array(z.string().trim().min(1).max(500)).max(20).default([]),
  fieldRules: z.array(WikiFieldRuleSchema).max(32).default([]),
  relationRules: z.array(WikiRelationRuleSchema).max(24).default([]),
  qualityPolicy: WikiQualityPolicySchema.optional(),
  nodeCreationPolicy: NodeCreationPolicySchema.optional(),
  candidateExtractionContract: CandidateExtractionContractSchema.optional(),
  frozen: z.boolean().optional(),
  analyzedDocumentIds: z.array(z.string().min(1)).max(100), createdAt: z.string().datetime(),
});
export type WikiGenerationPlan = z.infer<typeof WikiGenerationPlanSchema>;

export interface WikiClassificationDecision {
  semanticRole: WikiCategoryRole;
  categoryId: string;
  confidence: number;
  status: "accepted" | "corrected" | "needs_review";
  source: "lexical" | "llm" | "review" | "fallback";
  reason: string;
  semanticExplanation?: string;
  decisionFactors?: string[];
  identityEvidence?: string;
  proposedCategoryId?: string;
  alternatives?: string[];
}

export interface Project {
  id: string; name: string; createdAt: string; updatedAt?: string; profile?: WikiProfile;
  profileConfirmed: boolean; wikiRevision?: number; generationPlan?: WikiGenerationPlan;
  rebuildRequired?: boolean; ontologyRevision?: number; generationPlanFrozenAt?: string;
  latestBuildManifestId?: string;
}
export interface DocumentRecord {
  id: string; projectId: string; fileName: string; storagePath?: string; kind: DocumentKind;
  role: "source" | "profile"; status: "uploaded" | "parsed" | "failed"; error?: string;
  uploadedAt: string; contentHash?: string; parserEngine?: string; parserVersion?: string;
  chunkingVersion?: string; blockCount?: number; parseCommitPending?: boolean;
}
export interface DocumentBlock { id: string; documentId: string; page: number; section?: string; blockType: "paragraph" | "heading" | "table"; text: string; sourceLocation: string; }
export interface Evidence { id: string; documentId: string; page: number; section?: string; blockId: string; originalText: string; status: "observed" | "reported" | "inferred"; }
export const DocumentAnalysisRelevanceSchema = z.enum(["direct", "partial", "contextual", "out_of_scope"]);
export type DocumentAnalysisRelevance = z.infer<typeof DocumentAnalysisRelevanceSchema>;
export const DocumentKnowledgePointKindSchema = z.enum([
  "definition", "concept", "entity", "method", "finding", "relationship", "contradiction", "other",
]);
export type DocumentKnowledgePointKind = z.infer<typeof DocumentKnowledgePointKindSchema>;
export const DocumentKnowledgePointSchema = z.object({
  id: z.string().min(1), kind: DocumentKnowledgePointKindSchema,
  title: z.string().trim().min(1).max(200), statement: z.string().trim().min(1).max(1_500),
  status: z.enum(["observed", "reported", "inferred"]), scope: z.string().trim().max(500).optional(),
  conditions: z.record(z.string(), z.union([z.string(), z.number()])).default({}),
  importance: z.number().min(0).max(1), confidence: z.number().min(0).max(1),
  evidenceBlockIds: z.array(z.string().min(1)).min(1).max(32),
});
export type DocumentKnowledgePoint = z.infer<typeof DocumentKnowledgePointSchema>;
export const DocumentKnowledgeAnalysisSchema = z.object({
  id: z.string().min(1), version: z.literal("1.0"), projectId: z.string().min(1), documentId: z.string().min(1),
  contentHash: z.string().min(1), profileHash: z.string().min(1), outputLanguage: z.enum(["en", "zh"]),
  relevance: DocumentAnalysisRelevanceSchema, relevanceReason: z.string().trim().min(1).max(800),
  sourceBoundary: z.string().trim().min(1).max(1_000), summary: z.string().trim().min(1).max(2_500),
  themes: z.array(z.string().trim().min(1).max(160)).max(32),
  entities: z.array(z.object({
    name: z.string().trim().min(1).max(200), type: z.string().trim().max(100).optional(),
    aliases: z.array(z.string().trim().min(1).max(200)).max(20).default([]),
    evidenceBlockIds: z.array(z.string().min(1)).min(1).max(32),
  })).max(160),
  knowledgePoints: z.array(DocumentKnowledgePointSchema).max(320),
  suggestedWikiTopics: z.array(z.object({
    title: z.string().trim().min(1).max(200), reason: z.string().trim().min(1).max(800),
    evidenceBlockIds: z.array(z.string().min(1)).min(1).max(32),
  })).max(80),
  existingConceptLinks: z.array(z.object({
    registryEntryId: z.string().min(1), reason: z.string().trim().min(1).max(500),
    evidenceBlockIds: z.array(z.string().min(1)).min(1).max(32),
  })).max(80),
  coverage: z.object({
    analyzedBlockIds: z.array(z.string().min(1)), unresolvedBlockIds: z.array(z.string().min(1)),
  }),
  createdAt: z.string().datetime(),
});
export type DocumentKnowledgeAnalysis = z.infer<typeof DocumentKnowledgeAnalysisSchema>;
export type EvidenceClaimDisposition = "candidate" | "attach" | "ignore";
export type EvidenceClaimCoverageStatus = "claimed" | "no_goal_relevant_claim" | "unresolved";
export interface EvidenceClaim {
  id: string; projectId: string; ontologyRevision: number; blockId: string;
  disposition: EvidenceClaimDisposition; kind: string; statement: string;
  suggestedName?: string; suggestedType?: string; aliases: string[];
  properties: Record<string, string | number>; scope?: string;
  importance: number; confidence: number; reason: string;
  catalogCandidateName?: string; catalogAction?: SemanticResolutionAction;
  createdAt: string;
}
export interface EvidenceClaimCoverage {
  id: string; projectId: string; ontologyRevision: number; blockId: string;
  status: EvidenceClaimCoverageStatus; reason: string; claimIds: string[]; createdAt: string;
}
export const SemanticResolutionActionSchema = z.enum([
  "same_as", "alias_of", "instance_of", "facet_of", "specialization_of", "keep_separate", "uncertain",
]);
export type SemanticResolutionAction = z.infer<typeof SemanticResolutionActionSchema>;
export const SemanticResolutionMemberProposalSchema = z.object({
  candidateId: z.string().min(1), action: SemanticResolutionActionSchema,
  scope: z.string().trim().max(500).optional(),
  conditions: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
  reason: z.string().trim().min(1).max(500),
});
export const SemanticResolutionGroupProposalSchema = z.object({
  canonicalCandidateId: z.string().min(1), registryEntryId: z.string().min(1).optional(),
  canonicalName: z.string().trim().min(1).max(200), canonicalType: z.string().trim().min(1).max(100),
  canonicalSummary: z.string().trim().min(1).max(1_200),
  members: z.array(SemanticResolutionMemberProposalSchema).min(1).max(80),
  confidence: z.number().min(0).max(1), reason: z.string().trim().min(1).max(800),
});
export type SemanticResolutionGroupProposal = z.infer<typeof SemanticResolutionGroupProposalSchema>;
export const SemanticConsolidationOutputSchema = z.object({
  groups: z.array(SemanticResolutionGroupProposalSchema).max(240).default([]),
});
export type SemanticConsolidationOutput = z.infer<typeof SemanticConsolidationOutputSchema>;
export const CandidateCatalogMemberProposalSchema = z.object({
  claimId: z.string().min(1), action: SemanticResolutionActionSchema,
  scope: z.string().trim().max(500).optional(),
  conditions: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
  reason: z.string().trim().min(1).max(500),
});
export const CandidateCatalogGroupProposalSchema = z.object({
  canonicalClaimId: z.string().min(1), canonicalName: z.string().trim().min(1).max(200),
  canonicalType: z.string().trim().min(1).max(100), canonicalSummary: z.string().trim().min(1).max(1_200),
  members: z.array(CandidateCatalogMemberProposalSchema).min(1).max(120),
  importance: z.number().min(0).max(1), confidence: z.number().min(0).max(1),
  reason: z.string().trim().min(1).max(800),
});
export type CandidateCatalogGroupProposal = z.infer<typeof CandidateCatalogGroupProposalSchema>;
export const CandidateCatalogOutputSchema = z.object({
  groups: z.array(CandidateCatalogGroupProposalSchema).max(360).default([]),
});
export type CandidateCatalogOutput = z.infer<typeof CandidateCatalogOutputSchema>;
export const WikiSummaryOutputSchema = z.object({
  summaries: z.array(z.object({
    registryEntryId: z.string().min(1), summary: z.string().trim().min(1).max(2_000),
    confidence: z.number().min(0).max(1), reason: z.string().trim().min(1).max(500),
  })).max(240).default([]),
});
export type WikiSummaryOutput = z.infer<typeof WikiSummaryOutputSchema>;
export interface WikiSemanticMember {
  candidateId: string; name: string; action: SemanticResolutionAction; scope?: string;
  conditions?: Record<string, string | number>; reason: string;
}
export interface WikiNode {
  id: string; canonicalName: string; displayName: string; type: string; aliases: string[];
  summary: string; properties: Record<string, string | number>; importance: number;
  importanceReason?: string; confidence: number; confidenceReason?: string; evidenceIds: string[];
  classification?: WikiClassificationDecision; registryEntryId?: string;
  semanticMembers?: WikiSemanticMember[];
}
export interface WikiEdge { id: string; sourceNodeId: string; targetNodeId: string; relationType: string; direction: "directed" | "symmetric"; confidence: number; confidenceReason?: string; evidenceIds: string[]; relationStatus: "observed" | "reported" | "inferred"; conditions?: Record<string, string | number>; scope?: string; }
export interface ProcessingJob { id: string; projectId: string; status: JobStatus; progress: number; message: string; batchProgress?: JobBatchProgress; errors: string[]; createdAt: string; updatedAt: string; }
export interface BuildManifestDocument {
  documentId: string; fileName: string; contentHash: string; parserEngine: string;
  parserVersion: string; chunkingVersion: string; blockCount: number; blockFingerprint: string;
}
export interface BuildManifest {
  id: string; version: "1.0"; projectId: string; jobId: string; createdAt: string;
  inputFingerprint: string; profileHash: string; documents: BuildManifestDocument[];
  schemaVersion: string; promptVersions: Record<string, string>; ontologyRevision: number;
  provider: string; model: string; temperature: number; generationPlanFingerprint?: string;
}
export type KnowledgeCandidateDecision = "publish_node" | "review" | "ignore";
export interface KnowledgeCandidateScore {
  userRelevance: number; evidenceStrength: number; conceptualIndependence: number;
  structuredCompleteness: number; total: number;
}
export interface KnowledgeCandidate {
  id: string; projectId: string; canonicalKey: string; name: string; canonicalName?: string;
  proposedType?: string; aliases: string[]; summary: string; properties: Record<string, string | number>;
  evidenceBlockIds: string[]; sourceDocumentIds: string[]; score: KnowledgeCandidateScore;
  decision: KnowledgeCandidateDecision; decisionReason: string; ontologyRevision: number;
  importanceReason?: string; confidence?: number; confidenceReason?: string;
  classification?: WikiClassificationDecision;
  claimIds?: string[];
  createdAt: string; updatedAt: string;
}
export interface SemanticResolution {
  id: string; projectId: string; ontologyRevision: number; registryEntryId: string;
  canonicalCandidateId: string; canonicalName: string; canonicalType: string;
  canonicalSummary: string; members: WikiSemanticMember[]; confidence: number;
  reason: string; status: "accepted" | "needs_review"; source: "ai" | "fallback";
  createdAt: string;
}
export interface ConceptRegistryEntry {
  id: string; projectId: string; ontologyRevision: number; canonicalName: string;
  displayName: string; type: string; aliases: string[]; summary: string;
  memberCandidateIds: string[]; claimIds?: string[]; evidenceBlockIds: string[]; semanticMembers: WikiSemanticMember[];
  confidence: number; status: "active" | "needs_review" | "orphaned";
  createdAt: string; updatedAt: string;
}
export interface OntologyExtensionProposal {
  id: string; projectId: string; baseOntologyRevision: number; sourceDocumentIds: string[];
  categories: WikiCategory[]; fieldRules: WikiFieldRule[]; relationRules: WikiRelationRule[];
  status: "pending" | "accepted" | "rejected" | "superseded"; rationale: string;
  createdAt: string;
}
export interface SearchResult { nodes: WikiNode[]; edges: WikiEdge[]; evidence: Evidence[]; }
export interface ProjectSnapshot {
  project: Project; documents: DocumentRecord[]; job?: ProcessingJob; nodes: WikiNode[];
  edges: WikiEdge[]; evidence: Evidence[]; buildManifest?: BuildManifest;
  knowledgeCandidates?: KnowledgeCandidate[]; ontologyExtensionProposals?: OntologyExtensionProposal[];
  semanticResolutions?: SemanticResolution[]; conceptRegistry?: ConceptRegistryEntry[];
  evidenceClaims?: EvidenceClaim[]; evidenceClaimCoverage?: EvidenceClaimCoverage[];
  documentAnalyses?: DocumentKnowledgeAnalysis[];
}

export const ClaimStatusSchema = z.enum(["observed", "reported", "inferred"]);
export type ClaimStatus = z.infer<typeof ClaimStatusSchema>;
export const ChatCitationSchema = z.object({
  evidenceId: z.string().min(1), nodeId: z.string().min(1).optional(), documentId: z.string().min(1),
  documentName: z.string().min(1), page: z.number().int().positive(), blockId: z.string().min(1),
  section: z.string().optional(), topic: z.string().trim().min(1).max(160).optional(), status: ClaimStatusSchema,
});
export type ChatCitation = z.infer<typeof ChatCitationSchema>;
export const ChatClaimSchema = z.object({
  text: z.string().min(1).max(1_000), status: ClaimStatusSchema,
  nodeIds: z.array(z.string().min(1)).min(1).max(8), evidenceIds: z.array(z.string().min(1)).min(1).max(12),
});
export type ChatClaim = z.infer<typeof ChatClaimSchema>;
export const ChatAnswerSchema = z.object({
  answer: z.string().min(1).max(8_000), claims: z.array(ChatClaimSchema).max(8),
  citations: z.array(ChatCitationSchema).max(40), limitations: z.array(z.string().min(1).max(800)).max(5),
});
export type ChatAnswer = z.infer<typeof ChatAnswerSchema>;
export interface ChatThread { id: string; projectId: string; wikiRevision: number; title: string; createdAt: string; updatedAt: string; }
export interface ChatMessage { id: string; threadId: string; role: "user" | "assistant"; content: string; createdAt: string; wikiRevision?: number; answer?: ChatAnswer; }
export const CreateChatThreadSchema = z.object({ title: z.string().trim().min(1).max(120).optional() });
export const SendChatMessageSchema = z.object({ message: z.string().trim().min(1).max(8_000) });

export const CreateProjectSchema = z.object({ name: z.string().trim().min(1).max(120) });
export const UpdateProfileSchema = WikiProfileSchema;

import { z } from "zod";

export const DocumentKindSchema = z.enum(["pdf", "docx"]);
export type DocumentKind = z.infer<typeof DocumentKindSchema>;
export const JobStatusSchema = z.enum(["queued", "parsing", "analyzing", "planning", "filtering", "extracting", "resolving", "building_graph", "completed", "failed"]);
export type JobStatus = z.infer<typeof JobStatusSchema>;

export const WikiProfileSchema = z.object({
  version: z.literal("1.0"), researchGoal: z.string().min(1), domain: z.string().default("General research"),
  entityTypes: z.array(z.string()).default([]), importantFields: z.array(z.string()).default([]),
  preferredRelations: z.array(z.string()).default([]), exclude: z.array(z.string()).default([]),
  extractNumericData: z.boolean().default(true), preserveUnits: z.boolean().default(true), extractTables: z.boolean().default(false),
  evidenceRequired: z.boolean().default(true), notes: z.string().default(""), outputLanguage: z.enum(["en", "zh"]).optional()
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
export const WikiGenerationPlanSchema = z.object({
  version: z.literal("1.0"), outputLanguage: z.enum(["en", "zh"]), researchGoal: z.string().trim().min(1).max(1_000),
  corpusSummary: z.string().trim().min(1).max(2_000), themes: z.array(z.string().trim().min(1).max(160)).max(24),
  requiredKnowledge: z.array(z.string().trim().min(1).max(240)).max(24),
  categories: z.array(WikiCategorySchema).min(1).max(16),
  relationTypes: z.array(z.string().trim().min(1).max(100)).max(24),
  classificationRules: z.array(z.string().trim().min(1).max(320)).max(30),
  analyzedDocumentIds: z.array(z.string().min(1)).max(100), createdAt: z.string().datetime(),
});
export type WikiGenerationPlan = z.infer<typeof WikiGenerationPlanSchema>;

export interface Project { id: string; name: string; createdAt: string; profile?: WikiProfile; profileConfirmed: boolean; wikiRevision?: number; generationPlan?: WikiGenerationPlan; }
export interface DocumentRecord { id: string; projectId: string; fileName: string; storagePath?: string; kind: DocumentKind; role: "source" | "profile"; status: "uploaded" | "parsed" | "failed"; error?: string; uploadedAt: string; }
export interface DocumentBlock { id: string; documentId: string; page: number; section?: string; blockType: "paragraph" | "heading" | "table"; text: string; sourceLocation: string; }
export interface Evidence { id: string; documentId: string; page: number; section?: string; blockId: string; originalText: string; status: "observed" | "reported" | "inferred"; }
export interface WikiNode { id: string; canonicalName: string; displayName: string; type: string; aliases: string[]; summary: string; properties: Record<string, string | number>; importance: number; importanceReason?: string; confidence: number; confidenceReason?: string; evidenceIds: string[]; }
export interface WikiEdge { id: string; sourceNodeId: string; targetNodeId: string; relationType: string; direction: "directed"; confidence: number; confidenceReason?: string; evidenceIds: string[]; relationStatus: "observed" | "reported" | "inferred"; }
export interface ProcessingJob { id: string; projectId: string; status: JobStatus; progress: number; message: string; errors: string[]; createdAt: string; updatedAt: string; }
export interface SearchResult { nodes: WikiNode[]; edges: WikiEdge[]; evidence: Evidence[]; }
export interface ProjectSnapshot { project: Project; documents: DocumentRecord[]; job?: ProcessingJob; nodes: WikiNode[]; edges: WikiEdge[]; evidence: Evidence[]; }

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

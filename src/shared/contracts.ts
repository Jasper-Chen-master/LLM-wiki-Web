import { z } from "zod";

export const DocumentKindSchema = z.enum(["pdf", "docx"]);
export type DocumentKind = z.infer<typeof DocumentKindSchema>;
export const JobStatusSchema = z.enum(["queued", "parsing", "filtering", "extracting", "resolving", "building_graph", "completed", "failed"]);
export type JobStatus = z.infer<typeof JobStatusSchema>;

export const WikiProfileSchema = z.object({
  version: z.literal("1.0"), researchGoal: z.string().min(1), domain: z.string().default("General research"),
  entityTypes: z.array(z.string()).default([]), importantFields: z.array(z.string()).default([]),
  preferredRelations: z.array(z.string()).default([]), exclude: z.array(z.string()).default([]),
  extractNumericData: z.boolean().default(true), preserveUnits: z.boolean().default(true), extractTables: z.boolean().default(false),
  evidenceRequired: z.boolean().default(true), notes: z.string().default("")
});
export type WikiProfile = z.infer<typeof WikiProfileSchema>;

export interface Project { id: string; name: string; createdAt: string; profile?: WikiProfile; profileConfirmed: boolean; }
export interface DocumentRecord { id: string; projectId: string; fileName: string; storagePath?: string; kind: DocumentKind; role: "source" | "profile"; status: "uploaded" | "parsed" | "failed"; error?: string; uploadedAt: string; }
export interface DocumentBlock { id: string; documentId: string; page: number; section?: string; blockType: "paragraph" | "heading" | "table"; text: string; sourceLocation: string; }
export interface Evidence { id: string; documentId: string; page: number; section?: string; blockId: string; originalText: string; status: "observed" | "reported" | "inferred"; }
export interface WikiNode { id: string; canonicalName: string; displayName: string; type: string; aliases: string[]; summary: string; properties: Record<string, string | number>; importance: number; confidence: number; evidenceIds: string[]; }
export interface WikiEdge { id: string; sourceNodeId: string; targetNodeId: string; relationType: string; direction: "directed"; confidence: number; evidenceIds: string[]; relationStatus: "observed" | "reported" | "inferred"; }
export interface ProcessingJob { id: string; projectId: string; status: JobStatus; progress: number; message: string; errors: string[]; createdAt: string; updatedAt: string; }
export interface SearchResult { nodes: WikiNode[]; edges: WikiEdge[]; evidence: Evidence[]; }
export interface ProjectSnapshot { project: Project; documents: DocumentRecord[]; job?: ProcessingJob; nodes: WikiNode[]; edges: WikiEdge[]; evidence: Evidence[]; }

export const CreateProjectSchema = z.object({ name: z.string().trim().min(1).max(120) });
export const UpdateProfileSchema = WikiProfileSchema;

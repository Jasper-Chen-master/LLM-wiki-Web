import { randomUUID } from "node:crypto";
import type { ProcessingJob } from "../shared/contracts.js";
import type { Store } from "./store.js";
import { parseDocument } from "./parsing/document-parser.js";
import { buildGraph, mergeGraphInto, removeDocumentKnowledge } from "./services/graph-service.js";
import { getLlmProvider } from "./ai/provider.js";

export async function runProjectJob(store: Store, projectId: string): Promise<ProcessingJob> {
  const now = new Date().toISOString();
  const job: ProcessingJob = { id: randomUUID(), projectId, status: "queued", progress: 0, message: "Queued for processing", errors: [], createdAt: now, updatedAt: now };
  store.data.jobs.push(job); await store.save();
  void process(store, job);
  return job;
}
async function process(store: Store, job: ProcessingJob) {
  const update = async (status: ProcessingJob["status"], progress: number, message: string) => { job.status = status; job.progress = progress; job.message = message; job.updatedAt = new Date().toISOString(); await store.save(); };
  try {
    const docs = store.data.documents.filter(d => d.projectId === job.projectId && d.role === "source");
    const currentSourceIds = new Set(docs.map(doc => doc.id));
    // Blocks do not themselves carry a project id. Current documents identify active blocks;
    // orphaned document ids are recovered through the project graph's evidence references so
    // one project's job can never clean another project's raw document data.
    const projectEvidenceIds = new Set([
      ...store.data.nodes.filter(node => node.id.startsWith(`${job.projectId}:`)).flatMap(node => node.evidenceIds),
      ...store.data.edges.filter(edge => edge.id.startsWith(`${job.projectId}:`)).flatMap(edge => edge.evidenceIds),
    ]);
    const projectEvidenceDocumentIds = new Set(store.data.evidence
      .filter(evidence => projectEvidenceIds.has(evidence.id))
      .map(evidence => evidence.documentId));
    const processedIds = new Set(store.data.blocks
      .filter(block => currentSourceIds.has(block.documentId) || projectEvidenceDocumentIds.has(block.documentId))
      .map(block => block.documentId));
    const newDocs = docs.filter(doc => doc.status === "failed" || !processedIds.has(doc.id));
    const removedDocIds = new Set([...processedIds].filter(id => !currentSourceIds.has(id)));

    if (!newDocs.length && !removedDocIds.size) {
      await update("completed", 100, "No new or removed documents; nothing to reprocess");
      return;
    }

    // A failed document may have stale partial data from an older version. Remove only that
    // document's derived records before its single retry; untouched documents remain intact.
    const retryIds = new Set(newDocs.filter(doc => doc.status === "failed").map(doc => doc.id));
    removeDocumentKnowledge(store.data, job.projectId, removedDocIds);
    removeDocumentKnowledge(store.data, job.projectId, retryIds);

    await update("parsing", 15, `Parsing ${newDocs.length} new source document${newDocs.length === 1 ? "" : "s"}`);
    const parsedDocIds = new Set<string>();
    for (const doc of newDocs) { try { const blocks = await parseDocument(doc); store.data.blocks.push(...blocks); doc.status = "parsed"; delete doc.error; parsedDocIds.add(doc.id); } catch (error) { doc.status = "failed"; doc.error = error instanceof Error ? error.message : "Parser failed"; job.errors.push(`${doc.fileName}: ${doc.error}`); } }
    const newBlocks = store.data.blocks.filter(block => parsedDocIds.has(block.documentId));
    if (!newBlocks.length) {
      await update("completed", 100, job.errors.length ? "Completed with partial document failures; no new readable source text was extracted" : "No new readable source text was extracted");
      return;
    }
    await update("filtering", 35, `Selecting relevant blocks from ${parsedDocIds.size} new document${parsedDocIds.size === 1 ? "" : "s"}`);
    const project = store.data.projects.find(p => p.id === job.projectId); if (!project?.profile) throw new Error("Missing confirmed Wiki Profile");
    const provider = getLlmProvider();
    const relevant = await provider.filterRelevant(project.profile, newBlocks);
    await update("extracting", 55, `Extracting knowledge from ${parsedDocIds.size} new document${parsedDocIds.size === 1 ? "" : "s"}`);
    const extraction = await provider.extractKnowledge(project.profile, relevant);
    await update("resolving", 75, "Resolving duplicate entities");
    const graph = buildGraph(job.projectId, extraction, relevant);
    mergeGraphInto(store.data, job.projectId, graph);
    await update("building_graph", 90, "Building evidence-grounded graph");
    await update("completed", 100, graph.nodes.length ? (job.errors.length ? "Completed with partial document failures" : "Knowledge graph is ready") : "Completed, but no evidence-grounded entities were found. Refine the Research Profile or use a text-based PDF.");
  } catch (error) { job.errors.push(error instanceof Error ? error.message : "Processing failed"); await update("failed", 100, "Processing failed safely; review the error log and retry"); }
}

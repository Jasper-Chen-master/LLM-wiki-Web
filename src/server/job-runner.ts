import { randomUUID } from "node:crypto";
import type { ProcessingJob } from "../shared/contracts.js";
import type { Store } from "./store.js";
import { parseDocument } from "./parsing/document-parser.js";
import { buildGraph } from "./services/graph-service.js";
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
    // A rerun must replace derived knowledge, never accumulate stale graph records.
    const sourceIds = new Set(store.data.documents.filter(d => d.projectId === job.projectId && d.role === "source").map(d => d.id));
    store.data.blocks = store.data.blocks.filter(block => !sourceIds.has(block.documentId));
    store.data.evidence = store.data.evidence.filter(evidence => !sourceIds.has(evidence.documentId));
    store.data.nodes = store.data.nodes.filter(node => !node.id.startsWith(`${job.projectId}:`));
    store.data.edges = store.data.edges.filter(edge => !edge.id.startsWith(`${job.projectId}:`));
    await update("parsing", 15, "Parsing source documents");
    const docs = store.data.documents.filter(d => d.projectId === job.projectId && d.role === "source");
    for (const doc of docs) { try { const blocks = await parseDocument(doc); store.data.blocks.push(...blocks); doc.status = "parsed"; } catch (error) { doc.status = "failed"; doc.error = error instanceof Error ? error.message : "Parser failed"; job.errors.push(`${doc.fileName}: ${doc.error}`); } }
    if (!store.data.blocks.some(block => docs.some(doc => doc.id === block.documentId))) throw new Error("No readable source text was extracted; a knowledge graph cannot be built.");
    await update("filtering", 35, "Selecting blocks relevant to your research goal");
    const project = store.data.projects.find(p => p.id === job.projectId); if (!project?.profile) throw new Error("Missing confirmed Wiki Profile");
    const provider = getLlmProvider(); const blocks = store.data.blocks.filter(b => docs.some(d => d.id === b.documentId));
    const relevant = await provider.filterRelevant(project.profile, blocks);
    await update("extracting", 55, "Extracting entities, relations, and evidence");
    const extraction = await provider.extractKnowledge(project.profile, relevant);
    await update("resolving", 75, "Resolving duplicate entities");
    const graph = buildGraph(job.projectId, extraction, relevant);
    store.data.evidence.push(...graph.evidence); store.data.nodes.push(...graph.nodes); store.data.edges.push(...graph.edges);
    await update("building_graph", 90, "Building evidence-grounded graph");
    await update("completed", 100, graph.nodes.length ? (job.errors.length ? "Completed with partial document failures" : "Knowledge graph is ready") : "Completed, but no evidence-grounded entities were found. Refine the Research Profile or use a text-based PDF.");
  } catch (error) { job.errors.push(error instanceof Error ? error.message : "Processing failed"); await update("failed", 100, "Processing failed safely; review the error log and retry"); }
}

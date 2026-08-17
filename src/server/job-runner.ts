import { randomUUID } from "node:crypto";
import type { ProcessingJob } from "../shared/contracts.js";
import type { Store } from "./store.js";
import { parseDocument } from "./parsing/document-parser.js";
import { buildGraph, mergeGraphInto, removeDocumentKnowledge } from "./services/graph-service.js";
import { getLlmProvider } from "./ai/provider.js";
import type { WaitingProgressCallback } from "./ai/provider.js";
import { applyPlanToWikiNodes } from "./services/wiki-planning-service.js";

export async function runProjectJob(store: Store, projectId: string): Promise<ProcessingJob> {
  const now = new Date().toISOString();
  const job: ProcessingJob = { id: randomUUID(), projectId, status: "queued", progress: 0, message: "Queued for processing", errors: [], createdAt: now, updatedAt: now };
  store.data.jobs.push(job); await store.save();
  void process(store, job);
  return job;
}
async function process(store: Store, job: ProcessingJob) {
  const update = async (status: ProcessingJob["status"], progress: number, message: string, persist = true) => {
    job.status = status;
    job.progress = Math.max(job.progress, progress);
    job.message = message;
    job.updatedAt = new Date().toISOString();
    if (persist) await store.save();
    else await store.save({ throttleMs: 3_000 });
  };
  const maxWaitingProgress = new Map<ProcessingJob["status"], number>();
  const waitingUpdate = (status: ProcessingJob["status"], start: number, end: number, message: string): WaitingProgressCallback =>
    elapsedSeconds => {
      // The stage starts at the progress already reached by the job. The named
      // start is only a lower bound for callers that enter a stage early.
      const stageStart = Math.max(start, job.progress);
      const calculated = Math.min(end - 0.1, stageStart + ((end - stageStart) * Math.min(elapsedSeconds, 30)) / 30);
      const progress = Math.max(maxWaitingProgress.get(status) ?? stageStart, calculated);
      maxWaitingProgress.set(status, progress);
      return update(status, Math.floor(progress), `${message} · waiting ${elapsedSeconds}s`, false);
    };
  try {
    const docs = store.data.documents.filter(d => d.projectId === job.projectId && d.role === "source");
    const project = store.data.projects.find(p => p.id === job.projectId); if (!project?.profile) throw new Error("Missing confirmed Wiki Profile");
    const provider = getLlmProvider();
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

    if (!newDocs.length && !removedDocIds.size && project.generationPlan) {
      await update("completed", 100, "No new or removed documents; nothing to reprocess");
      return;
    }

    if (!newDocs.length && !removedDocIds.size) {
      const currentBlocks = store.data.blocks.filter(block => currentSourceIds.has(block.documentId));
      if (currentBlocks.length) {
        let planningPhase: "analyzing" | "planning" = "analyzing";
        project.generationPlan = await provider.buildGenerationPlan(project.profile, currentBlocks, async phase => {
          planningPhase = phase;
          await update(phase, phase === "analyzing" ? job.progress : 45, phase === "analyzing" ? "Analyzing research goal against existing source content" : "Planning controlled Wiki categories");
        }, elapsed => waitingUpdate(planningPhase, planningPhase === "analyzing" ? job.progress : 45, planningPhase === "analyzing" ? 45 : 55, planningPhase === "analyzing" ? "Analyzing research goal against existing source content" : "Planning controlled Wiki categories")(elapsed));
        applyPlanToWikiNodes(project.generationPlan, store.data.nodes.filter(node => node.id.startsWith(`${job.projectId}:`)));
        project.wikiRevision = (project.wikiRevision ?? 0) + 1;
      }
      await update("completed", 100, currentBlocks.length ? "Existing Wiki categories were analyzed and validated" : "No readable source text was available for analysis");
      return;
    }

    // A failed document may have stale partial data from an older version. Remove only that
    // document's derived records before its single retry; untouched documents remain intact.
    const retryIds = new Set(newDocs.filter(doc => doc.status === "failed").map(doc => doc.id));
    removeDocumentKnowledge(store.data, job.projectId, removedDocIds);
    removeDocumentKnowledge(store.data, job.projectId, retryIds);

    await update("parsing", Math.max(job.progress, 1), `Parsing ${newDocs.length} new source document${newDocs.length === 1 ? "" : "s"}`);
    const parsedDocIds = new Set<string>();
    for (const [index, doc] of newDocs.entries()) {
      try {
        const blocks = await parseDocument(doc);
        store.data.blocks.push(...blocks);
        doc.status = "parsed";
        delete doc.error;
        parsedDocIds.add(doc.id);
      } catch (error) {
        doc.status = "failed";
        doc.error = error instanceof Error ? error.message : "Parser failed";
        job.errors.push(`${doc.fileName}: ${doc.error}`);
      }
      const parsingProgress = Math.round(((index + 1) / newDocs.length) * 30);
      await update("parsing", parsingProgress, `Parsed ${index + 1} of ${newDocs.length} source documents`);
    }
    const newBlocks = store.data.blocks.filter(block => parsedDocIds.has(block.documentId));
    const currentBlocks = store.data.blocks.filter(block => currentSourceIds.has(block.documentId));
    if (!newBlocks.length) {
      if (currentBlocks.length && removedDocIds.size) {
        let planningPhase: "analyzing" | "planning" = "analyzing";
        project.generationPlan = await provider.buildGenerationPlan(project.profile, currentBlocks, async phase => {
          planningPhase = phase;
          await update(phase, phase === "analyzing" ? job.progress : 45, phase === "analyzing" ? "Analyzing research goal against current source content" : "Planning controlled Wiki categories");
        }, elapsed => waitingUpdate(planningPhase, planningPhase === "analyzing" ? job.progress : 45, planningPhase === "analyzing" ? 45 : 55, planningPhase === "analyzing" ? "Analyzing research goal against current source content" : "Planning controlled Wiki categories")(elapsed));
        applyPlanToWikiNodes(project.generationPlan, store.data.nodes.filter(node => node.id.startsWith(`${job.projectId}:`)));
      }
      await update("completed", 100, job.errors.length ? "Completed with partial document failures; no new readable source text was extracted" : "No new readable source text was extracted");
      return;
    }
    let planningPhase: "analyzing" | "planning" = "analyzing";
    project.generationPlan = await provider.buildGenerationPlan(project.profile, currentBlocks, async phase => {
      planningPhase = phase;
      await update(phase, phase === "analyzing" ? job.progress : 45, phase === "analyzing" ? "Analyzing research goal against source content" : "Planning controlled Wiki categories");
    }, elapsed => waitingUpdate(planningPhase, planningPhase === "analyzing" ? job.progress : 45, planningPhase === "analyzing" ? 45 : 55, planningPhase === "analyzing" ? "Analyzing research goal against source content" : "Planning controlled Wiki categories")(elapsed));
    applyPlanToWikiNodes(project.generationPlan, store.data.nodes.filter(node => node.id.startsWith(`${job.projectId}:`)));
    const filteringMessage = `Selecting relevant blocks from ${parsedDocIds.size} new document${parsedDocIds.size === 1 ? "" : "s"}`;
    await update("filtering", 55, filteringMessage);
    const relevant = await provider.filterRelevant(project.profile, project.generationPlan, newBlocks, waitingUpdate("filtering", 55, 65, filteringMessage));
    const extractingMessage = `Extracting knowledge from ${parsedDocIds.size} new document${parsedDocIds.size === 1 ? "" : "s"}`;
    await update("extracting", 65, extractingMessage);
    const extraction = await provider.extractKnowledge(project.profile, project.generationPlan, relevant, waitingUpdate("extracting", 65, 82, extractingMessage));
    await update("resolving", 82, "Resolving duplicate entities and validating categories");
    const graph = buildGraph(job.projectId, extraction, relevant);
    mergeGraphInto(store.data, job.projectId, graph);
    // Chat retrieval reads the live Wiki snapshot on every question. Advancing this revision
    // marks the completed state that includes the newly processed document(s).
    project.wikiRevision = (project.wikiRevision ?? 0) + 1;
    await update("building_graph", 93, "Building evidence-grounded graph");
    await update("completed", 100, graph.nodes.length ? (job.errors.length ? "Completed with partial document failures" : "Knowledge graph is ready") : "Completed, but no evidence-grounded entities were found. Refine the Research Profile or use a text-based PDF.");
  } catch (error) { job.errors.push(error instanceof Error ? error.message : "Processing failed"); await update("failed", 100, "Processing failed safely; review the error log and retry"); }
}

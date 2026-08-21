import { randomUUID } from "node:crypto";
import type { JobBatchPhase, JobBatchProgress, ProcessingJob } from "../shared/contracts.js";
import type { Store } from "./store.js";
import { parseDocument } from "./parsing/document-parser.js";
import { buildGraph, clearProjectGraphKnowledge, mergeGraphInto, removeDocumentKnowledge } from "./services/graph-service.js";
import { getLlmProvider } from "./ai/provider.js";
import type { WaitingProgressCallback } from "./ai/provider.js";
import { applyPlanToWikiNodes } from "./services/wiki-planning-service.js";

const runningJobs = new Map<string, { job: ProcessingJob; task: Promise<void> }>();
const terminalStatuses = new Set<ProcessingJob["status"]>(["completed", "failed"]);

export async function recoverInterruptedJobs(store: Store) {
  let changed = false;
  for (const job of store.data.jobs) {
    if (terminalStatuses.has(job.status)) continue;
    job.status = "failed";
    job.progress = 100;
    job.message = "Processing was interrupted by a server restart; retry to resume from persisted documents";
    delete job.batchProgress;
    job.errors.push("The in-process worker stopped before this job completed.");
    job.updatedAt = new Date().toISOString();
    changed = true;
  }
  if (changed) await store.save();
}

export async function runProjectJob(store: Store, projectId: string): Promise<ProcessingJob> {
  const running = runningJobs.get(projectId);
  if (running) return running.job;
  const now = new Date().toISOString();
  const job: ProcessingJob = { id: randomUUID(), projectId, status: "queued", progress: 0, message: "Queued for processing", errors: [], createdAt: now, updatedAt: now };
  store.data.jobs.push(job);
  // Reserve the project before the first await so simultaneous confirm requests cannot
  // create duplicate workers for the same project.
  runningJobs.set(projectId, { job, task: Promise.resolve() });
  try { await store.save(); } catch (error) { runningJobs.delete(projectId); throw error; }
  const task = processJob(store, job).finally(() => {
    if (runningJobs.get(projectId)?.job.id === job.id) runningJobs.delete(projectId);
  });
  runningJobs.set(projectId, { job, task });
  void task;
  return job;
}
async function processJob(store: Store, job: ProcessingJob) {
  const update = async (
    status: ProcessingJob["status"],
    progress: number,
    message: string,
    persist = true,
    batchProgress?: JobBatchProgress,
  ) => {
    const statusChanged = job.status !== status;
    job.status = status;
    job.progress = Math.max(job.progress, progress);
    job.message = message;
    if (batchProgress) job.batchProgress = batchProgress;
    else if (statusChanged || terminalStatuses.has(status)) delete job.batchProgress;
    job.updatedAt = new Date().toISOString();
    if (persist) await store.save();
    else await store.save({ throttleMs: 10_000 });
  };
  const maxWaitingProgress = new Map<ProcessingJob["status"], number>();
  const waitingUpdate = (
    status: ProcessingJob["status"],
    start: number,
    end: number,
    message: string,
    phaseRanges: Partial<Record<JobBatchPhase, [number, number]>> = {},
  ): WaitingProgressCallback =>
    batch => {
      const [phaseStart, phaseEnd] = phaseRanges[batch.phase] ?? [start, end];
      const completedRatio = batch.total > 0 ? Math.min(1, batch.completed / batch.total) : 1;
      const calculated = phaseStart + (phaseEnd - phaseStart) * completedRatio;
      const progress = Math.max(maxWaitingProgress.get(status) ?? start, calculated);
      maxWaitingProgress.set(status, progress);
      const batchLabel = batch.total > 0 ? ` · batch ${batch.completed}/${batch.total}` : "";
      return update(status, Math.floor(progress), `${message}${batchLabel} · ${batch.elapsedSeconds}s`, false, batch);
    };
  const planningWaitingUpdate = (analysisMessage: string, planningMessage: string): WaitingProgressCallback => {
    const analysisProgress = waitingUpdate("analyzing", job.progress, 45, analysisMessage);
    const planProgress = waitingUpdate("planning", 45, 55, planningMessage);
    return batch => batch.phase === "plan_generation" ? planProgress(batch) : analysisProgress(batch);
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
    const rebuildAll = Boolean((project.rebuildRequired || !project.generationPlan) && processedIds.size);

    if (!newDocs.length && !removedDocIds.size && project.generationPlan && !rebuildAll) {
      await update("completed", 100, "No new or removed documents; nothing to reprocess");
      return;
    }

    // A failed document may have stale partial data from an older version. Remove only that
    // document's derived records before its single retry; untouched documents remain intact.
    const retryIds = new Set(newDocs.filter(doc => doc.status === "failed").map(doc => doc.id));
    removeDocumentKnowledge(store.data, job.projectId, removedDocIds);
    removeDocumentKnowledge(store.data, job.projectId, retryIds);

    if (newDocs.length) await update("parsing", Math.max(job.progress, 1), `Parsing ${newDocs.length} new source document${newDocs.length === 1 ? "" : "s"}`);
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
    const knowledgeBlocks = rebuildAll ? currentBlocks : newBlocks;
    if (!knowledgeBlocks.length) {
      if (currentBlocks.length && removedDocIds.size) {
        project.generationPlan = await provider.buildGenerationPlan(project.profile, currentBlocks, async phase => {
          await update(phase, phase === "analyzing" ? job.progress : 45, phase === "analyzing" ? "Analyzing research goal against current source content" : "Planning controlled Wiki categories");
        }, planningWaitingUpdate("Analyzing research goal against current source content", "Planning controlled Wiki categories"));
        applyPlanToWikiNodes(project.generationPlan, store.data.nodes.filter(node => node.id.startsWith(`${job.projectId}:`)));
      }
      await update("completed", 100, job.errors.length ? "Completed with processing warnings; no new readable source text was extracted" : "No new readable source text was extracted");
      return;
    }
    project.generationPlan = await provider.buildGenerationPlan(project.profile, currentBlocks, async phase => {
      await update(phase, phase === "analyzing" ? job.progress : 45, phase === "analyzing" ? "Analyzing research goal against source content" : "Planning controlled Wiki categories");
    }, planningWaitingUpdate("Analyzing research goal against source content", "Planning controlled Wiki categories"));
    if (!rebuildAll) applyPlanToWikiNodes(project.generationPlan, store.data.nodes.filter(node => node.id.startsWith(`${job.projectId}:`)));
    const processedDocumentCount = rebuildAll ? currentSourceIds.size : parsedDocIds.size;
    const filteringMessage = `Selecting relevant blocks from ${processedDocumentCount} ${rebuildAll ? "current" : "new"} document${processedDocumentCount === 1 ? "" : "s"}`;
    await update("filtering", 55, filteringMessage);
    const relevant = await provider.filterRelevant(project.profile, project.generationPlan, knowledgeBlocks, waitingUpdate("filtering", 55, 65, filteringMessage));
    const extractingMessage = `Extracting knowledge from ${processedDocumentCount} ${rebuildAll ? "current" : "new"} document${processedDocumentCount === 1 ? "" : "s"}`;
    await update("extracting", 65, extractingMessage);
    const extraction = await provider.extractKnowledge(project.profile, project.generationPlan, relevant, waitingUpdate(
      "extracting",
      65,
      82,
      extractingMessage,
      { extraction: [65, 74], semantic_interpretation: [74, 78], classification: [78, 82] },
    ));
    await update("resolving", 82, "Resolving duplicate entities and applying controlled categories");
    const graph = buildGraph(job.projectId, extraction, relevant, project.generationPlan);
    if (rebuildAll) clearProjectGraphKnowledge(store.data, job.projectId);
    mergeGraphInto(store.data, job.projectId, graph);
    // Chat retrieval reads the live Wiki snapshot on every question. Advancing this revision
    // marks the completed state that includes the newly processed document(s).
    project.wikiRevision = (project.wikiRevision ?? 0) + 1;
    await update("building_graph", 93, "Building evidence-grounded graph");
    project.rebuildRequired = false;
    project.updatedAt = new Date().toISOString();
    await update("completed", 100, graph.nodes.length ? "Knowledge graph is ready." : "Completed, but no evidence-grounded entities were found. Refine the Research Profile or use a text-based PDF.");
  } catch (error) { job.errors.push(error instanceof Error ? error.message : "Processing failed"); await update("failed", 100, "Processing failed safely; review the error log and retry"); }
}

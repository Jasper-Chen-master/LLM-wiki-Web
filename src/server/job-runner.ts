import { randomUUID } from "node:crypto";
import type { EvidenceClaimCoverage, JobBatchPhase, JobBatchProgress, ProcessingJob } from "../shared/contracts.js";
import type { Store } from "./store.js";
import { parseDocument } from "./parsing/document-parser.js";
import { DOCUMENT_CHUNKING_VERSION } from "./document-parser.js";
import { buildGraph, clearProjectGraphKnowledge, mergeGraphInto, removeDocumentKnowledge } from "./services/graph-service.js";
import { getLlmProvider } from "./ai/provider.js";
import type { WaitingProgressCallback } from "./ai/provider.js";
import { createBuildManifest, WIKI_SCHEMA_VERSION } from "./services/build-manifest-service.js";
import { evaluateKnowledgeCandidates, mergeKnowledgeCandidates } from "./services/knowledge-candidate-service.js";
import { createOntologyExtensionProposal } from "./services/ontology-extension-service.js";
import {
  applyStableConceptSummaries, materializeSemanticConsolidation, mergeConceptRegistry, rewriteRelationsWithSemanticMap,
} from "./services/semantic-consolidation-service.js";
import {
  materializeCandidateCatalog, materializeEvidenceClaimLedger, mergeEvidenceClaimCoverage, mergeEvidenceClaims,
} from "./services/candidate-claim-service.js";
import { replaceDocumentAnalyses } from "./services/document-analysis-service.js";

const runningJobs = new Map<string, { job: ProcessingJob; task: Promise<void> }>();
const terminalStatuses = new Set<ProcessingJob["status"]>(["completed", "failed"]);

export function hasUnresolvedOnlyClaimLedger(coverage: Pick<EvidenceClaimCoverage, "status">[], claimCount: number): boolean {
  return coverage.length > 0 && claimCount === 0 && coverage.every(item => item.status === "unresolved");
}

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
    const profile = project.profile;
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
    const newDocs = docs.filter(doc => doc.status === "failed" || doc.parseCommitPending || !processedIds.has(doc.id) || doc.chunkingVersion !== DOCUMENT_CHUNKING_VERSION);
    const removedDocIds = new Set([...processedIds].filter(id => !currentSourceIds.has(id)));
    const latestManifest = store.data.buildManifests.find(item => item.id === project.latestBuildManifestId);
    const derivedSchemaOutdated = processedIds.size > 0 && latestManifest?.schemaVersion !== WIKI_SCHEMA_VERSION;
    const existingClaimCoverage = store.data.evidenceClaimCoverage.filter(item => item.projectId === job.projectId);
    const existingClaimCount = store.data.evidenceClaims.filter(item => item.projectId === job.projectId).length;
    const unresolvedOnlyClaimLedger = hasUnresolvedOnlyClaimLedger(existingClaimCoverage, existingClaimCount);
    const rebuildAll = Boolean((project.rebuildRequired || !project.generationPlan || derivedSchemaOutdated || unresolvedOnlyClaimLedger) && processedIds.size);

    if (!newDocs.length && !removedDocIds.size && project.generationPlan && !rebuildAll) {
      await update("completed", 100, "No new or removed documents; nothing to reprocess");
      return;
    }

    // Existing blocks remain live until the complete replacement build succeeds.
    const retryIds = new Set(newDocs.filter(doc => doc.status === "failed" || processedIds.has(doc.id)).map(doc => doc.id));
    removeDocumentKnowledge(store.data, job.projectId, removedDocIds);

    if (newDocs.length) await update("parsing", Math.max(job.progress, 1), `Parsing ${newDocs.length} new source document${newDocs.length === 1 ? "" : "s"}`);
    const parsedDocIds = new Set<string>();
    const stagedBlocks: typeof store.data.blocks = [];
    for (const [index, doc] of newDocs.entries()) {
      try {
        const blocks = await parseDocument(doc);
        stagedBlocks.push(...blocks);
        doc.parseCommitPending = true;
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
    const newBlocks = stagedBlocks;
    const currentBlocks = [
      ...store.data.blocks.filter(block => currentSourceIds.has(block.documentId) && !parsedDocIds.has(block.documentId)),
      ...stagedBlocks,
    ];
    const knowledgeBlocks = rebuildAll ? currentBlocks : newBlocks;
    const pendingDocumentAnalyses: Array<{ documentIds: Set<string>; analyses: Awaited<ReturnType<typeof provider.analyzeDocuments>> }> = [];
    const analyzeDocumentsForPlan = async (
      targetDocs: typeof docs,
      targetBlocks: typeof currentBlocks,
      analysisMessage: string,
      planningMessage: string,
    ) => {
      const analyses = await provider.analyzeDocuments(
        project.id,
        profile,
        targetDocs,
        targetBlocks,
        store.data.conceptRegistry.filter(entry => entry.projectId === project.id && entry.status !== "orphaned"),
        planningWaitingUpdate(analysisMessage, planningMessage),
      );
      pendingDocumentAnalyses.push({ documentIds: new Set(targetDocs.map(doc => doc.id)), analyses });
      const unresolvedBlockCount = analyses.reduce((sum, analysis) => sum + analysis.coverage.unresolvedBlockIds.length, 0);
      if (unresolvedBlockCount) {
        job.errors.push(`${unresolvedBlockCount} source block(s) remain unresolved after document-level analysis.`);
      }
      return analyses;
    };
    if (!knowledgeBlocks.length) {
      if (currentBlocks.length && !project.generationPlan) {
        const analyses = await analyzeDocumentsForPlan(
          docs,
          currentBlocks,
          "Analyzing research goal against current source content",
          "Planning controlled Wiki categories",
        );
        const initialPlan = await provider.buildGenerationPlan(
          profile,
          currentBlocks,
          analyses,
          planningWaitingUpdate("Analyzing research goal against current source content", "Planning controlled Wiki categories"),
        );
        for (const pending of pendingDocumentAnalyses) replaceDocumentAnalyses(store.data, project.id, pending.documentIds, pending.analyses);
        project.generationPlan = { ...initialPlan, frozen: true };
        project.ontologyRevision = (project.ontologyRevision ?? 0) + 1;
        project.generationPlanFrozenAt = new Date().toISOString();
      }
      await update("completed", 100, job.errors.length ? "Completed with partial document failures; no new readable source text was extracted" : "No new readable source text was extracted");
      return;
    }
    // A legacy plan has no frozen Candidate Extraction Contract, so it cannot safely drive
    // the claim ledger. Regenerate it as a new ontology revision during this schema migration.
    const needsNewPlan = !project.generationPlan || Boolean(project.rebuildRequired) || !project.generationPlan.candidateExtractionContract;
    let activePlan = project.generationPlan;
    let activeOntologyRevision = project.ontologyRevision ?? 0;
    if (needsNewPlan) {
      const analyses = await analyzeDocumentsForPlan(
        docs,
        currentBlocks,
        "Analyzing research goal against source content",
        "Planning controlled Wiki categories",
      );
      const generatedPlan = await provider.buildGenerationPlan(
        profile,
        currentBlocks,
        analyses,
        planningWaitingUpdate("Analyzing research goal against source content", "Planning controlled Wiki categories"),
      );
      activePlan = { ...generatedPlan, frozen: true };
      activeOntologyRevision += 1;
    } else if (newBlocks.length && activePlan) {
      // New documents may suggest additions, but they cannot silently rewrite the frozen plan.
      const newSourceDocs = docs.filter(doc => parsedDocIds.has(doc.id));
      const analyses = await analyzeDocumentsForPlan(
        newSourceDocs,
        newBlocks,
        "Checking new sources for ontology extensions",
        "Comparing extension candidates with the frozen plan",
      );
      const proposedPlan = await provider.buildGenerationPlan(
        profile,
        newBlocks,
        analyses,
        planningWaitingUpdate("Checking new sources for ontology extensions", "Comparing extension candidates with the frozen plan"),
      );
      const proposal = createOntologyExtensionProposal({
        projectId: project.id,
        baseOntologyRevision: activeOntologyRevision,
        basePlan: activePlan,
        proposedPlan,
        sourceDocumentIds: [...parsedDocIds],
      });
      if (proposal && !store.data.ontologyExtensionProposals.some(item => item.id === proposal.id)) {
        store.data.ontologyExtensionProposals.push(proposal);
      }
    }
    if (!activePlan) throw new Error("A validated Wiki generation plan could not be created");
    const manifest = await createBuildManifest({
      projectId: project.id,
      jobId: job.id,
      profile,
      documents: docs,
      blocks: currentBlocks,
      ontologyRevision: activeOntologyRevision,
      plan: activePlan,
    });
    store.data.buildManifests.push(manifest);
    const processedDocumentCount = rebuildAll ? currentSourceIds.size : parsedDocIds.size;
    const filteringMessage = `Selecting relevant blocks from ${processedDocumentCount} ${rebuildAll ? "current" : "new"} document${processedDocumentCount === 1 ? "" : "s"}`;
    await update("filtering", 55, filteringMessage);
    const relevant = await provider.filterRelevant(profile, activePlan, knowledgeBlocks, waitingUpdate("filtering", 55, 65, filteringMessage));
    const extractingMessage = `Building evidence claims from ${processedDocumentCount} ${rebuildAll ? "current" : "new"} document${processedDocumentCount === 1 ? "" : "s"}`;
    await update("extracting", 65, extractingMessage);
    const claimExtraction = await provider.extractEvidenceClaims(profile, activePlan, relevant, waitingUpdate(
      "extracting",
      65,
      78,
      extractingMessage,
      { claim_extraction: [65, 78] },
    ));
    const claimLedger = materializeEvidenceClaimLedger({
      projectId: project.id, ontologyRevision: activeOntologyRevision, blocks: relevant, extraction: claimExtraction,
    });
    const unresolvedCoverage = claimLedger.coverage.filter(item => item.status === "unresolved");
    if (unresolvedCoverage.length) {
      job.errors.push(`${unresolvedCoverage.length} relevant block(s) were retained as unresolved in the Evidence Claim ledger.`);
    }
    await update("resolving", 78, "Building a global AI candidate catalog from the evidence-claim ledger");
    const catalogProposal = await provider.catalogEvidenceClaims(
      profile,
      activePlan,
      claimLedger.claims,
      waitingUpdate(
        "resolving",
        78,
        84,
        "Assigning every evidence claim to a global candidate catalog",
        { candidate_catalog: [78, 84] },
      ),
    );
    const catalog = materializeCandidateCatalog({
      projectId: project.id, plan: activePlan, claims: claimLedger.claims, proposal: catalogProposal,
    });
    const currentBlockIds = new Set(currentBlocks.map(block => block.id));
    const priorCandidateEntities = rebuildAll ? [] : store.data.knowledgeCandidates
      .filter(candidate => candidate.projectId === project.id)
      .map(candidate => ({
        name: candidate.name, canonicalName: candidate.canonicalName, type: candidate.proposedType,
        aliases: candidate.aliases, summary: candidate.summary, properties: candidate.properties,
        importance: candidate.score.userRelevance,
        claimIds: candidate.claimIds,
        evidenceIds: candidate.evidenceBlockIds.filter(id => currentBlockIds.has(id)),
      }))
      .filter(candidate => candidate.evidenceIds.length > 0);
    const candidateEvaluation = evaluateKnowledgeCandidates({
      projectId: project.id,
      ontologyRevision: activeOntologyRevision,
      profile,
      plan: activePlan,
      entities: [...priorCandidateEntities, ...catalog.entities],
      blocks: currentBlocks,
    });
    const eligibleCandidates = candidateEvaluation.candidates.filter(candidate => candidate.decision !== "ignore");
    const existingRegistry = rebuildAll ? [] : store.data.conceptRegistry.filter(entry => (
      entry.projectId === project.id && entry.status !== "orphaned"
    ));
    const semanticProposal = await provider.consolidateKnowledgeCandidates(
      profile,
      activePlan,
      eligibleCandidates,
      currentBlocks,
      existingRegistry,
      waitingUpdate(
        "resolving",
        84,
        90,
        "Using AI semantic understanding to consolidate overlapping concepts",
        { semantic_consolidation: [84, 90] },
      ),
    );
    const consolidation = materializeSemanticConsolidation({
      projectId: project.id,
      ontologyRevision: activeOntologyRevision,
      plan: activePlan,
      candidates: eligibleCandidates,
      proposal: semanticProposal,
      existingRegistry,
    });
    const summaryOutput = await provider.summarizeConceptRegistry(
      profile,
      activePlan,
      consolidation.registryEntries,
      currentBlocks,
      waitingUpdate(
        "resolving",
        90,
        92,
        "Writing stable Wiki summaries from each canonical evidence set",
        { wiki_summarization: [90, 92] },
      ),
    );
    const summarizedConsolidation = applyStableConceptSummaries({
      existingRegistry,
      registryEntries: consolidation.registryEntries,
      consolidatedEntities: consolidation.consolidatedEntities,
      summaries: summaryOutput,
    });
    // Node eligibility remains a deterministic publication gate. It runs after semantic
    // consolidation and therefore does not decide whether two concepts mean the same thing.
    const canonicalEvaluation = evaluateKnowledgeCandidates({
      projectId: project.id,
      ontologyRevision: activeOntologyRevision,
      profile,
      plan: activePlan,
      entities: summarizedConsolidation.consolidatedEntities,
      blocks: currentBlocks,
    });
    const catalogRelations = rewriteRelationsWithSemanticMap(
      claimExtraction.relations,
      catalog.canonicalNameByClaimName,
    );
    const rewrittenRelations = rewriteRelationsWithSemanticMap(
      catalogRelations,
      consolidation.canonicalNameByCandidateName,
    );
    const graphBlockIds = new Set([
      ...canonicalEvaluation.publishableEntities.flatMap(entity => entity.evidenceIds ?? []),
      ...rewrittenRelations.flatMap(relation => relation.evidenceIds ?? []),
    ]);
    const graphBlocks = currentBlocks.filter(block => graphBlockIds.has(block.id));
    const graph = buildGraph(job.projectId, {
      entities: canonicalEvaluation.publishableEntities,
      relations: rewrittenRelations,
    }, graphBlocks, activePlan);
    // Commit staged parser output only after planning, extraction, eligibility, and graph
    // validation all succeed. A crash leaves parseCommitPending=true so retry reparses safely.
    const committedRetryIds = new Set([...retryIds].filter(id => parsedDocIds.has(id)));
    if (committedRetryIds.size) removeDocumentKnowledge(store.data, job.projectId, committedRetryIds);
    if (rebuildAll) {
      clearProjectGraphKnowledge(store.data, job.projectId);
      store.data.semanticResolutions = store.data.semanticResolutions.filter(item => item.projectId !== project.id);
      store.data.conceptRegistry = store.data.conceptRegistry.filter(item => item.projectId !== project.id);
      store.data.evidenceClaims = store.data.evidenceClaims.filter(item => item.projectId !== project.id);
      store.data.evidenceClaimCoverage = store.data.evidenceClaimCoverage.filter(item => item.projectId !== project.id);
    }
    for (const pending of pendingDocumentAnalyses) replaceDocumentAnalyses(store.data, project.id, pending.documentIds, pending.analyses);
    store.data.blocks.push(...stagedBlocks);
    for (const doc of newDocs) if (parsedDocIds.has(doc.id)) doc.parseCommitPending = false;
    store.data.knowledgeCandidates = mergeKnowledgeCandidates(store.data.knowledgeCandidates, candidateEvaluation.candidates);
    store.data.evidenceClaims = mergeEvidenceClaims(store.data.evidenceClaims, catalog.claims);
    store.data.evidenceClaimCoverage = mergeEvidenceClaimCoverage(store.data.evidenceClaimCoverage, claimLedger.coverage);
    const resolutionById = new Map(store.data.semanticResolutions.map(item => [item.id, item]));
    for (const resolution of consolidation.resolutions) resolutionById.set(resolution.id, resolution);
    store.data.semanticResolutions = [...resolutionById.values()];
    store.data.conceptRegistry = mergeConceptRegistry(store.data.conceptRegistry, summarizedConsolidation.registryEntries);
    mergeGraphInto(store.data, job.projectId, graph);
    if (needsNewPlan) {
      project.generationPlan = activePlan;
      project.ontologyRevision = activeOntologyRevision;
      project.generationPlanFrozenAt = new Date().toISOString();
    }
    project.latestBuildManifestId = manifest.id;
    // Chat retrieval reads the live Wiki snapshot on every question. Advancing this revision
    // marks the completed state that includes the newly processed document(s).
    project.wikiRevision = (project.wikiRevision ?? 0) + 1;
    await update("building_graph", 93, "Building evidence-grounded graph");
    project.rebuildRequired = false;
    project.updatedAt = new Date().toISOString();
    await update("completed", 100, graph.nodes.length ? (job.errors.length ? "Completed with partial document failures; knowledge graph is ready." : "Knowledge graph is ready.") : "Completed, but no evidence-grounded entities were found. Refine the Research Profile or use a text-based PDF.");
  } catch (error) { job.errors.push(error instanceof Error ? error.message : "Processing failed"); await update("failed", 100, "Processing failed safely; review the error log and retry"); }
}

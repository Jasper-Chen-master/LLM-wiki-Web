import type { ProjectSnapshot } from "../../../shared/contracts";
import { Alert, Status } from "../../components/ui";
import { useI18n } from "../../i18n";

export function JobPanel({ snapshot }: { snapshot: ProjectSnapshot }) {
  const { t } = useI18n();
  const job = snapshot.job;
  const presentation = job ? {
    queued: { label: t.jobQueued, message: t.jobQueuedMessage },
    parsing: { label: t.jobParsing, message: t.jobParsingMessage },
    analyzing: { label: t.jobAnalyzing, message: t.jobAnalyzingMessage },
    planning: { label: t.jobPlanning, message: t.jobPlanningMessage },
    filtering: { label: t.jobFiltering, message: t.jobFilteringMessage },
    extracting: { label: t.jobExtracting, message: t.jobExtractingMessage },
    resolving: { label: t.jobResolving, message: t.jobResolvingMessage },
    building_graph: { label: t.jobBuildingGraph, message: t.jobBuildingGraphMessage },
    completed: { label: t.jobCompleted, message: t.jobCompletedMessage },
    failed: { label: t.jobFailed, message: t.jobFailedMessage },
  }[job.status] : undefined;
  const batch = job?.batchProgress;
  const batchLabel = batch ? {
    corpus_analysis: t.jobCorpusAnalysis,
    plan_generation: t.jobPlanGeneration,
    relevance: t.jobRelevance,
    extraction: t.jobExtraction,
    semantic_interpretation: t.jobSemanticInterpretation,
    classification: t.jobClassification,
  }[batch.phase] : undefined;
  // Older persisted jobs may still contain the removed post-classification review diagnostics.
  // They are historical data, not actionable classification messages, so keep them out of the UI.
  const visibleErrors = (job?.errors ?? []).filter(error =>
    !/语义理解|类别仍为待复核|semantic interpretation|classification.*(?:review|pending)/iu.test(error),
  );
  const elapsed = batch
    ? batch.elapsedSeconds >= 60
      ? `${Math.floor(batch.elapsedSeconds / 60)}m ${batch.elapsedSeconds % 60}s`
      : `${batch.elapsedSeconds}s`
    : undefined;
  return (
    <section className="panel job-panel">
      <p className="eyebrow">03 · {t.processing}</p>
      <h2>{t.processing}</h2>
      {job ? (
        <>
          <div className="job-head">
            <Status
              label={presentation?.label ?? job.status}
              tone={job.status === "completed" ? "good" : "pending"}
            />
            <strong>{job.progress}%</strong>
          </div>
          <div className="progress">
            <i style={{ width: `${job.progress}%` }} />
          </div>
          <p>{presentation?.message ?? job.message}</p>
          {batch && batchLabel && (
            <p className="muted">{batchLabel}：{batch.completed}/{batch.total} · {t.jobElapsed} {elapsed}</p>
          )}
          {visibleErrors.map((error) => (
            <Alert key={error} message={error} />
          ))}
        </>
      ) : (
        <p className="muted">{t.processingHelp}</p>
      )}
    </section>
  );
}

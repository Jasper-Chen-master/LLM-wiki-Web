import { describe, expect, it, vi } from "vitest";
import type { ProcessingJob, Project } from "../shared/contracts.js";
import { recoverInterruptedJobs, runProjectJob } from "./job-runner.js";
import { Store } from "./store.js";

const project = (): Project => ({
  id: "project-a",
  name: "Project A",
  createdAt: "2026-08-18T00:00:00.000Z",
  profileConfirmed: true,
  wikiRevision: 0,
  profile: {
    version: "1.0", researchGoal: "Understand the sources", domain: "Research",
    entityTypes: ["Concept"], importantFields: [], preferredRelations: [], exclude: [],
    extractNumericData: true, preserveUnits: true, extractTables: false, evidenceRequired: true, notes: "", outputLanguage: "en",
  },
});

describe("project job coordination", () => {
  it("returns the same running job for simultaneous requests in one project", async () => {
    const store = new Store();
    store.data.projects.push(project());
    vi.spyOn(store, "save").mockImplementation(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
    const [first, second] = await Promise.all([runProjectJob(store, "project-a"), runProjectJob(store, "project-a")]);
    expect(second.id).toBe(first.id);
    expect(store.data.jobs).toHaveLength(1);
  });

  it("marks in-process jobs as interrupted after a server restart", async () => {
    const store = new Store();
    vi.spyOn(store, "save").mockResolvedValue();
    const job: ProcessingJob = {
      id: "job-a", projectId: "project-a", status: "extracting", progress: 75,
      message: "Extracting", batchProgress: { phase: "extraction", completed: 2, total: 5, elapsedSeconds: 30 },
      errors: [], createdAt: "2026-08-18T00:00:00.000Z", updatedAt: "2026-08-18T00:01:00.000Z",
    };
    store.data.jobs.push(job);
    await recoverInterruptedJobs(store);
    expect(job.status).toBe("failed");
    expect(job.batchProgress).toBeUndefined();
    expect(job.errors).toContain("The in-process worker stopped before this job completed.");
    expect(store.save).toHaveBeenCalledOnce();
  });
});

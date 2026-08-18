import { describe, expect, it, vi } from "vitest";
import type { LLMProvider } from "../llm-provider.js";
import { ChatService } from "./chat-service.js";
import { Store } from "../store.js";
import type { ProjectSnapshot } from "../../shared/contracts.js";
import { resolveWikiNodeIds, retrieveWikiChatContextForNodeIds, wikiNodeCatalog } from "./wiki-chat-retrieval-service.js";
import { wikiChatSystemPrompt } from "../prompts/wiki-chat.js";

const projectId = "project-a";
const nodeId = `${projectId}:node:energy`;
const evidenceId = "evidence-a";

function snapshot(): ProjectSnapshot {
  return {
    project: { id: projectId, name: "Energy study", createdAt: "2026-01-01T00:00:00.000Z", profileConfirmed: true, wikiRevision: 3, profile: { version: "1.0", researchGoal: "Understand energy storage", domain: "Materials", entityTypes: [], importantFields: [], preferredRelations: [], exclude: [], extractNumericData: true, preserveUnits: true, extractTables: false, evidenceRequired: true, notes: "" } },
    documents: [{ id: "doc-a", projectId, fileName: "paper-a.pdf", kind: "pdf", role: "source", status: "parsed", uploadedAt: "2026-01-01T00:00:00.000Z" }],
    job: { id: "job-a", projectId, status: "completed", progress: 100, message: "ready", errors: [], createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
    nodes: [{ id: nodeId, canonicalName: "Energy storage", displayName: "Energy storage", type: "Concept", aliases: ["storage"], summary: "Energy storage retains energy for later use.", properties: { metric: "capacity" }, importance: 0.9, confidence: 0.8, evidenceIds: [evidenceId] }],
    edges: [],
    evidence: [{ id: evidenceId, documentId: "doc-a", page: 7, blockId: "block-a", originalText: "SECRET RAW SOURCE TEXT MUST NEVER REACH CHAT", status: "reported" }],
  };
}

describe("Wiki chat", () => {
  it("asks the provider to return formulas as LaTeX", () => {
    expect(wikiChatSystemPrompt("zh")).toContain("$...$");
    expect(wikiChatSystemPrompt("zh")).toContain("\\ce{");
    expect(wikiChatSystemPrompt("zh")).toContain("【推断】");
  });

  it("builds model context without raw evidence text", () => {
    const context = retrieveWikiChatContextForNodeIds(snapshot(), [nodeId]);
    expect(context).toBeDefined();
    expect(JSON.stringify(context)).not.toContain("SECRET RAW SOURCE TEXT");
    expect(JSON.stringify(context)).not.toContain("originalText");
    expect(context?.allowedEvidenceIds).toEqual([evidenceId]);
  });

  it("provides a compact Wiki-only catalog for question analysis", () => {
    const input = snapshot();
    const catalog = wikiNodeCatalog(input);
    expect(catalog).toEqual([expect.objectContaining({ id: nodeId, name: "Energy storage" })]);
    expect(JSON.stringify(catalog)).not.toContain("SECRET RAW SOURCE TEXT");
  });

  it("resolves a provider's unambiguous node hash only within the current project", () => {
    expect(resolveWikiNodeIds(snapshot(), [nodeId.split(":").at(-1)!])).toEqual([nodeId]);
    expect(resolveWikiNodeIds(snapshot(), ["another-project:node:energy"])).toEqual([]);
  });

  it("uses AI question analysis to select Wiki topics before writing an answer", async () => {
    const provider: LLMProvider = {
      generate: vi.fn()
        .mockResolvedValueOnce({ provider: "test", text: JSON.stringify({ nodeIds: [nodeId] }) })
        .mockResolvedValueOnce({ provider: "test", text: JSON.stringify({ answer: "Energy storage can be understood as retaining energy so it remains available later.", claims: [{ text: "The Wiki describes energy storage as retaining energy for later use.", status: "reported", nodeIds: [nodeId], evidenceIds: [evidenceId] }], limitations: [] }) }),
    };
    const store = new Store();
    vi.spyOn(store, "save").mockResolvedValue();
    const input = snapshot();
    store.data.projects.push(input.project); store.data.documents.push(...input.documents); store.data.nodes.push(...input.nodes); store.data.evidence.push(...input.evidence); store.data.jobs.push(input.job!);
    const service = new ChatService(store, provider);
    const thread = service.createThread(projectId);
    const reply = await service.send(projectId, thread.id, "What practical role does the stored energy play?");
    expect(reply.assistant.content).toContain("retaining energy");
    expect(store.data.projects[0]?.updatedAt).toBeUndefined();
    expect(vi.mocked(provider.generate)).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(vi.mocked(provider.generate).mock.calls)).not.toContain("SECRET RAW SOURCE TEXT");
  });

  it("binds model-selected evidence IDs to server-side file and page citations", async () => {
    const provider: LLMProvider = { generate: vi.fn()
      .mockResolvedValueOnce({ provider: "test", text: JSON.stringify({ nodeIds: [nodeId] }) })
      .mockResolvedValueOnce({ provider: "test", text: JSON.stringify({ answer: "Energy storage retains energy.", claims: [{ text: "Energy storage retains energy.", status: "reported", nodeIds: [nodeId], evidenceIds: [evidenceId] }], limitations: [] }) }) };
    const store = new Store();
    vi.spyOn(store, "save").mockResolvedValue();
    const input = snapshot();
    store.data.projects.push(input.project); store.data.documents.push(...input.documents); store.data.nodes.push(...input.nodes); store.data.evidence.push(...input.evidence); store.data.jobs.push(input.job!);
    const service = new ChatService(store, provider);
    const thread = service.createThread(projectId);
    const reply = await service.send(projectId, thread.id, "Explain energy storage");
    expect(reply.assistant.answer?.citations).toEqual([expect.objectContaining({
      evidenceId, documentName: "paper-a.pdf", page: 7, topic: "Energy storage",
    })]);
    expect(JSON.stringify(vi.mocked(provider.generate).mock.calls)).not.toContain("SECRET RAW SOURCE TEXT");
  });

  it("retries when an AI answer exposes internal IDs in readable prose", async () => {
    const provider: LLMProvider = { generate: vi.fn()
      .mockResolvedValueOnce({ provider: "test", text: JSON.stringify({ nodeIds: [nodeId] }) })
      .mockResolvedValueOnce({ provider: "test", text: JSON.stringify({ answer: `Energy storage is supported by (${nodeId}, evidence ${evidenceId}).`, claims: [{ text: `Storage is reported by ${evidenceId}.`, status: "reported", nodeIds: [nodeId], evidenceIds: [evidenceId] }], limitations: [] }) })
      .mockResolvedValueOnce({ provider: "test", text: JSON.stringify({ answer: "Energy storage retains energy for later use.", claims: [{ text: "The Wiki reports that energy storage retains energy for later use.", status: "reported", nodeIds: [nodeId], evidenceIds: [evidenceId] }], limitations: [] }) }) };
    const store = new Store();
    vi.spyOn(store, "save").mockResolvedValue();
    const input = snapshot();
    store.data.projects.push(input.project); store.data.documents.push(...input.documents); store.data.nodes.push(...input.nodes); store.data.evidence.push(...input.evidence); store.data.jobs.push(input.job!);
    const service = new ChatService(store, provider);
    const thread = service.createThread(projectId);
    const reply = await service.send(projectId, thread.id, "Explain energy storage");
    expect(reply.assistant.content).not.toContain(nodeId);
    expect(reply.assistant.content).not.toContain(evidenceId);
    expect(vi.mocked(provider.generate)).toHaveBeenCalledTimes(3);
  });

  it("permits evidence-bound inference only when it is explicitly disclosed", async () => {
    const provider: LLMProvider = { generate: vi.fn()
      .mockResolvedValueOnce({ provider: "test", text: JSON.stringify({ nodeIds: [nodeId] }) })
      .mockResolvedValueOnce({ provider: "test", text: JSON.stringify({ answer: "Energy storage may improve later availability.", claims: [{ text: "Inference: energy storage may improve later availability.", status: "inferred", nodeIds: [nodeId], evidenceIds: [evidenceId] }], limitations: [] }) })
      .mockResolvedValueOnce({ provider: "test", text: JSON.stringify({ answer: "Inference: Energy storage may improve later availability; this is an evidence-based Wiki synthesis, not a direct source statement.", claims: [{ text: "Inference: energy storage may improve later availability.", status: "inferred", nodeIds: [nodeId], evidenceIds: [evidenceId] }], limitations: [] }) }) };
    const store = new Store();
    vi.spyOn(store, "save").mockResolvedValue();
    const input = snapshot();
    store.data.projects.push(input.project); store.data.documents.push(...input.documents); store.data.nodes.push(...input.nodes); store.data.evidence.push(...input.evidence); store.data.jobs.push(input.job!);
    const service = new ChatService(store, provider);
    const thread = service.createThread(projectId);
    const reply = await service.send(projectId, thread.id, "What could energy storage enable?");
    expect(reply.assistant.answer?.claims[0]?.status).toBe("inferred");
    expect(reply.assistant.content).toContain("Inference:");
    expect(vi.mocked(provider.generate)).toHaveBeenCalledTimes(3);
  });

  it("rejects an AI citation that was not retrieved for the current project", async () => {
    const provider: LLMProvider = { generate: vi.fn()
      .mockResolvedValueOnce({ provider: "test", text: JSON.stringify({ nodeIds: [nodeId] }) })
      .mockResolvedValue({ provider: "test", text: JSON.stringify({ answer: "Unsupported.", claims: [{ text: "Unsupported.", status: "reported", nodeIds: [nodeId], evidenceIds: ["forged-evidence"] }], limitations: [] }) }) };
    const store = new Store();
    vi.spyOn(store, "save").mockResolvedValue();
    const input = snapshot();
    store.data.projects.push(input.project); store.data.documents.push(...input.documents); store.data.nodes.push(...input.nodes); store.data.evidence.push(...input.evidence); store.data.jobs.push(input.job!);
    const service = new ChatService(store, provider);
    const thread = service.createThread(projectId);
    await expect(service.send(projectId, thread.id, "Explain energy storage")).rejects.toMatchObject({ status: 502 });
    expect(store.data.chatMessages).toHaveLength(0);
  });

  it("reports a missing AI configuration instead of pretending the Wiki has no match", async () => {
    const store = new Store();
    vi.spyOn(store, "save").mockResolvedValue();
    const input = snapshot();
    input.project.profile = { ...input.project.profile!, outputLanguage: "zh" };
    store.data.projects.push(input.project); store.data.documents.push(...input.documents); store.data.nodes.push(...input.nodes); store.data.evidence.push(...input.evidence); store.data.jobs.push(input.job!);
    const service = new ChatService(store);
    const thread = service.createThread(projectId);
    await expect(service.send(projectId, thread.id, "介绍角动量")).rejects.toMatchObject({ status: 503 });
  });

  it("deletes a chat thread together with all of its messages", async () => {
    const store = new Store();
    vi.spyOn(store, "save").mockResolvedValue();
    const input = snapshot();
    store.data.projects.push(input.project);
    const service = new ChatService(store);
    const thread = service.createThread(projectId);
    store.data.chatMessages.push({ id: "message-a", threadId: thread.id, role: "user", content: "Question", createdAt: new Date().toISOString() });
    await service.deleteThread(projectId, thread.id);
    expect(service.listThreads(projectId)).toEqual([]);
    expect(store.data.chatMessages).toEqual([]);
    expect(store.save).toHaveBeenCalledOnce();
  });

  it("deletes conversations in any project without affecting other projects", async () => {
    const store = new Store();
    vi.spyOn(store, "save").mockResolvedValue();
    const input = snapshot();
    const otherProjectId = "project-b";
    store.data.projects.push(input.project, { ...input.project, id: otherProjectId, name: "Other project" });
    const service = new ChatService(store);
    const firstProjectThread = service.createThread(projectId, "First project chat");
    const secondProjectThread = service.createThread(otherProjectId, "Second project chat");
    store.data.chatMessages.push(
      { id: "message-a", threadId: firstProjectThread.id, role: "user", content: "First question", createdAt: new Date().toISOString() },
      { id: "message-b", threadId: secondProjectThread.id, role: "user", content: "Second question", createdAt: new Date().toISOString() },
    );
    await service.deleteThread(otherProjectId, secondProjectThread.id);
    expect(service.listThreads(projectId)).toEqual([firstProjectThread]);
    expect(service.listThreads(otherProjectId)).toEqual([]);
    expect(store.data.chatMessages).toEqual([expect.objectContaining({ threadId: firstProjectThread.id })]);
  });
});

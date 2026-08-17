import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  ChatAnswerSchema,
  type ChatAnswer,
  type ChatCitation,
  type ChatMessage,
  type ChatThread,
  type ProjectSnapshot,
} from "../../shared/contracts.js";
import { createLLMProvider, DemoLLMProvider, generateStructured, type LLMProvider } from "../llm-provider.js";
import type { Store } from "../store.js";
import { wikiChatPrompt, wikiChatSystemPrompt, wikiNodeSelectionPrompt, wikiNodeSelectionSystemPrompt } from "../prompts/wiki-chat.js";
import { resolveWikiNodeIds, retrieveWikiChatContextForNodeIds, wikiNodeCatalog } from "./wiki-chat-retrieval-service.js";

const GeneratedAnswerSchema = z.object({
  answer: z.string().min(1).max(8_000),
  claims: z.array(z.object({
    text: z.string().min(1).max(1_000), status: z.enum(["observed", "reported", "inferred"]),
    nodeIds: z.array(z.string().min(1)).min(1).max(8), evidenceIds: z.array(z.string().min(1)).min(1).max(12),
  })).max(8),
  limitations: z.array(z.string().min(1).max(800)).max(5).default([]),
});
const NodeSelectionSchema = z.object({ nodeIds: z.array(z.string().min(1)).max(8).default([]) });

export class ChatApiError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

const snapshotFor = (store: Store, projectId: string): ProjectSnapshot | undefined => {
  const project = store.data.projects.find(item => item.id === projectId);
  if (!project) return undefined;
  const documents = store.data.documents.filter(item => item.projectId === projectId);
  const documentIds = new Set(documents.map(item => item.id));
  return {
    project, documents, job: store.data.jobs.filter(item => item.projectId === projectId).at(-1),
    nodes: store.data.nodes.filter(item => item.id.startsWith(`${projectId}:`)),
    edges: store.data.edges.filter(item => item.id.startsWith(`${projectId}:`)),
    evidence: store.data.evidence.filter(item => documentIds.has(item.documentId)),
  };
};

const titleFrom = (question: string) => question.replace(/\s+/g, " ").trim().slice(0, 72) || "New chat";
const unique = <T>(values: T[]) => [...new Set(values)];
const insufficientWikiAnswer = (language: "en" | "zh" | undefined): ChatAnswer => language === "zh"
  ? { answer: "当前项目的 Wiki 中没有足够的匹配结构化知识来回答这个问题。", claims: [], citations: [], limitations: ["没有检索到相关的 Wiki 节点、关系或证据。请处理更多源文档，或使用当前 Wiki 中已有的实体名称提问。"] }
  : { answer: "The current project Wiki does not contain enough matching structured knowledge to answer this question.", claims: [], citations: [], limitations: ["No relevant Wiki nodes, relations, or evidence were retrieved. Process more source documents or ask with a Wiki entity name."] };

export class ChatService {
  constructor(private readonly store: Store, private readonly provider: LLMProvider = createLLMProvider()) {}

  listThreads(projectId: string) {
    this.ensureProject(projectId);
    return this.store.data.chatThreads.filter(thread => thread.projectId === projectId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  createThread(projectId: string, title?: string): ChatThread {
    const snapshot = this.ensureProject(projectId);
    const now = new Date().toISOString();
    const thread: ChatThread = { id: randomUUID(), projectId, wikiRevision: snapshot.project.wikiRevision ?? 0, title: title?.trim().slice(0, 120) || "New chat", createdAt: now, updatedAt: now };
    this.store.data.chatThreads.push(thread);
    return thread;
  }

  messages(projectId: string, threadId: string) {
    this.thread(projectId, threadId);
    return this.store.data.chatMessages.filter(message => message.threadId === threadId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async send(projectId: string, threadId: string, content: string): Promise<{ user: ChatMessage; assistant: ChatMessage }> {
    const snapshot = this.ensureProject(projectId);
    const thread = this.thread(projectId, threadId);
    if (!snapshot.job || snapshot.job.status !== "completed") throw new ChatApiError(409, "The current Wiki is still processing. Ask after document processing completes.");
    const now = new Date().toISOString();
    const user: ChatMessage = { id: randomUUID(), threadId, role: "user", content, createdAt: now, wikiRevision: snapshot.project.wikiRevision ?? 0 };

    let answer: ChatAnswer;
    let context: ReturnType<typeof retrieveWikiChatContextForNodeIds>;
    if (this.provider instanceof DemoLLMProvider) {
      throw new ChatApiError(503, "Configure the server-side AI API before using Wiki chat.");
    }
    try {
      const selection = await generateStructured(this.provider, {
        system: wikiNodeSelectionSystemPrompt(),
        prompt: wikiNodeSelectionPrompt(content, wikiNodeCatalog(snapshot)),
        temperature: 0,
      }, NodeSelectionSchema, 1);
      context = retrieveWikiChatContextForNodeIds(snapshot, resolveWikiNodeIds(snapshot, selection.nodeIds));
    } catch {
      throw new ChatApiError(502, "The AI could not analyze the question against the current Wiki. Check the AI API configuration and try again.");
    }
    if (!context) {
      answer = insufficientWikiAnswer(snapshot.project.profile?.outputLanguage);
    } else {
      const history = this.messages(projectId, threadId).slice(-6).map(message => ({ role: message.role, content: message.content.slice(0, 1_600) }));
      let validationError: unknown;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const generated = await generateStructured(this.provider, {
            system: wikiChatSystemPrompt(snapshot.project.profile?.outputLanguage),
            prompt: `${wikiChatPrompt(content, history, context)}${attempt ? "\nYour previous answer used invalid or missing citations. Use only allowed ids and return evidence-bound claims." : ""}`,
            temperature: 0,
          }, GeneratedAnswerSchema, 1);
          answer = this.bindAndValidateAnswer(generated, context, snapshot);
          validationError = undefined;
          break;
        } catch (error) { validationError = error; }
      }
      if (validationError) throw validationError;
      if (!answer!) throw new ChatApiError(502, "The AI did not produce a valid evidence-bound answer.");
    }
    const assistant: ChatMessage = { id: randomUUID(), threadId, role: "assistant", content: answer.answer, answer, createdAt: new Date().toISOString(), wikiRevision: snapshot.project.wikiRevision ?? 0 };
    this.store.data.chatMessages.push(user);
    this.store.data.chatMessages.push(assistant);
    thread.title = thread.title === "New chat" ? titleFrom(content) : thread.title;
    thread.updatedAt = assistant.createdAt;
    await this.store.save();
    return { user, assistant };
  }

  async saveThread(projectId: string, title?: string) {
    const thread = this.createThread(projectId, title);
    await this.store.save();
    return thread;
  }

  private ensureProject(projectId: string) {
    const snapshot = snapshotFor(this.store, projectId);
    if (!snapshot) throw new ChatApiError(404, "Project not found");
    return snapshot;
  }

  private thread(projectId: string, threadId: string) {
    const thread = this.store.data.chatThreads.find(item => item.id === threadId && item.projectId === projectId);
    if (!thread) throw new ChatApiError(404, "Chat thread not found in this project");
    return thread;
  }

  private bindAndValidateAnswer(generated: z.infer<typeof GeneratedAnswerSchema>, context: NonNullable<ReturnType<typeof retrieveWikiChatContextForNodeIds>>, snapshot: ProjectSnapshot): ChatAnswer {
    const allowedNodes = new Set(context.allowedNodeIds);
    const allowedEvidence = new Set(context.allowedEvidenceIds);
    if (generated.claims.some(claim => claim.nodeIds.some(id => !allowedNodes.has(id)) || claim.evidenceIds.some(id => !allowedEvidence.has(id)))) {
      throw new ChatApiError(502, "The AI returned a citation outside the retrieved Wiki context.");
    }
    if (!generated.claims.length) throw new ChatApiError(502, "The AI response did not contain evidence-bound claims.");
    const evidenceById = new Map(context.evidence.map(item => [item.id, item]));
    const documentsById = new Map(snapshot.documents.map(item => [item.id, item]));
    const citations: ChatCitation[] = unique(generated.claims.flatMap(claim => claim.evidenceIds)).map(evidenceId => {
      const evidence = evidenceById.get(evidenceId);
      const document = evidence && documentsById.get(evidence.documentId);
      if (!evidence || !document) throw new ChatApiError(502, "A retrieved citation can no longer be resolved in this project.");
      const claimedNodeIds = unique(generated.claims
        .filter(claim => claim.evidenceIds.includes(evidenceId))
        .flatMap(claim => claim.nodeIds));
      const supportedNodes = context.nodes.filter(node =>
        node.evidenceIds.includes(evidenceId) && claimedNodeIds.includes(node.id));
      const fallbackNodes = context.nodes.filter(node => node.evidenceIds.includes(evidenceId));
      const topicNodes = supportedNodes.length ? supportedNodes : fallbackNodes;
      const topic = unique(topicNodes.map(node => node.displayName || node.canonicalName))
        .slice(0, 2)
        .join("、") || evidence.section?.trim();
      const nodeId = topicNodes[0]?.id ?? claimedNodeIds[0];
      return {
        evidenceId, nodeId, documentId: document.id, documentName: document.fileName,
        page: evidence.page, blockId: evidence.blockId, section: evidence.section, topic, status: evidence.status,
      };
    });
    return ChatAnswerSchema.parse({ ...generated, citations });
  }
}

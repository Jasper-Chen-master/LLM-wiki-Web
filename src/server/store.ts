import fs from "node:fs/promises";
import path from "node:path";
import type { ChatMessage, ChatThread, DocumentBlock, DocumentRecord, Evidence, ProcessingJob, Project, WikiEdge, WikiNode } from "../shared/contracts.js";

export interface PersistedState { projects: Project[]; documents: DocumentRecord[]; blocks: DocumentBlock[]; evidence: Evidence[]; nodes: WikiNode[]; edges: WikiEdge[]; jobs: ProcessingJob[]; chatThreads: ChatThread[]; chatMessages: ChatMessage[]; }
const empty = (): PersistedState => ({ projects: [], documents: [], blocks: [], evidence: [], nodes: [], edges: [], jobs: [], chatThreads: [], chatMessages: [] });
export class Store {
  private state: PersistedState = empty();
  private lastSavedAt = 0;
  private saveChain: Promise<void> = Promise.resolve();
  constructor(private readonly file = path.resolve("data", "workspace.json")) {}
  async load() {
    try {
      const parsed = JSON.parse(await fs.readFile(this.file, "utf8")) as Partial<PersistedState>;
      this.state = { ...empty(), ...parsed, chatThreads: parsed.chatThreads ?? [], chatMessages: parsed.chatMessages ?? [] };
      for (const project of this.state.projects) project.wikiRevision ??= 0;
    } catch { this.state = empty(); }
  }
  get data() { return this.state; }
  async save(options: { throttleMs?: number } = {}) {
    const now = Date.now();
    if (options.throttleMs && now - this.lastSavedAt < options.throttleMs) return this.saveChain;
    this.saveChain = this.saveChain.then(async () => {
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      await fs.writeFile(this.file, JSON.stringify(this.state, null, 2));
      this.lastSavedAt = Date.now();
    });
    return this.saveChain;
  }
}

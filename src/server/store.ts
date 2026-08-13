import fs from "node:fs/promises";
import path from "node:path";
import type { DocumentBlock, DocumentRecord, Evidence, ProcessingJob, Project, WikiEdge, WikiNode } from "../shared/contracts.js";

export interface PersistedState { projects: Project[]; documents: DocumentRecord[]; blocks: DocumentBlock[]; evidence: Evidence[]; nodes: WikiNode[]; edges: WikiEdge[]; jobs: ProcessingJob[]; }
const empty = (): PersistedState => ({ projects: [], documents: [], blocks: [], evidence: [], nodes: [], edges: [], jobs: [] });
export class Store {
  private state: PersistedState = empty();
  constructor(private readonly file = path.resolve("data", "workspace.json")) {}
  async load() { try { this.state = JSON.parse(await fs.readFile(this.file, "utf8")) as PersistedState; } catch { this.state = empty(); } }
  get data() { return this.state; }
  async save() { await fs.mkdir(path.dirname(this.file), { recursive: true }); await fs.writeFile(this.file, JSON.stringify(this.state, null, 2)); }
}

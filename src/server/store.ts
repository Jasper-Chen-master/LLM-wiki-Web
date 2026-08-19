import fs from "node:fs/promises";
import path from "node:path";
import type {
  BuildManifest, ChatMessage, ChatThread, ConceptRegistryEntry, DocumentBlock, DocumentKnowledgeAnalysis, DocumentRecord, Evidence,
  EvidenceClaim, EvidenceClaimCoverage, KnowledgeCandidate, OntologyExtensionProposal,
  ProcessingJob, Project, SemanticResolution, WikiEdge, WikiNode,
} from "../shared/contracts.js";

export interface PersistedState {
  projects: Project[]; documents: DocumentRecord[]; blocks: DocumentBlock[]; evidence: Evidence[];
  nodes: WikiNode[]; edges: WikiEdge[]; jobs: ProcessingJob[]; chatThreads: ChatThread[];
  chatMessages: ChatMessage[]; buildManifests: BuildManifest[];
  knowledgeCandidates: KnowledgeCandidate[]; ontologyExtensionProposals: OntologyExtensionProposal[];
  semanticResolutions: SemanticResolution[]; conceptRegistry: ConceptRegistryEntry[];
  evidenceClaims: EvidenceClaim[]; evidenceClaimCoverage: EvidenceClaimCoverage[];
  documentAnalyses: DocumentKnowledgeAnalysis[];
}
const empty = (): PersistedState => ({
  projects: [], documents: [], blocks: [], evidence: [], nodes: [], edges: [], jobs: [],
  chatThreads: [], chatMessages: [], buildManifests: [], knowledgeCandidates: [],
  ontologyExtensionProposals: [], semanticResolutions: [], conceptRegistry: [], evidenceClaims: [], evidenceClaimCoverage: [],
  documentAnalyses: [],
});
export class Store {
  private state: PersistedState = empty();
  private lastSavedAt = 0;
  private saveChain: Promise<void> = Promise.resolve();
  constructor(private readonly file = path.resolve("data", "workspace.json")) {}
  async load() {
    try {
      const parsed = JSON.parse(await fs.readFile(this.file, "utf8")) as Partial<PersistedState>;
      this.state = {
        ...empty(), ...parsed,
        chatThreads: parsed.chatThreads ?? [], chatMessages: parsed.chatMessages ?? [],
        buildManifests: parsed.buildManifests ?? [],
        knowledgeCandidates: parsed.knowledgeCandidates ?? [],
        ontologyExtensionProposals: parsed.ontologyExtensionProposals ?? [],
        semanticResolutions: parsed.semanticResolutions ?? [],
        conceptRegistry: parsed.conceptRegistry ?? [],
        evidenceClaims: parsed.evidenceClaims ?? [],
        evidenceClaimCoverage: parsed.evidenceClaimCoverage ?? [],
        documentAnalyses: parsed.documentAnalyses ?? [],
      };
      for (const project of this.state.projects) {
        project.wikiRevision ??= 0;
        project.ontologyRevision ??= project.generationPlan ? 1 : 0;
        if (project.generationPlan && !project.generationPlanFrozenAt) {
          project.generationPlanFrozenAt = project.generationPlan.createdAt;
        }
        if (project.generationPlan) project.generationPlan.frozen = true;
        // Backward-compatible migration for workspaces saved before edit tracking.
        project.updatedAt ??= project.createdAt;
      }
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

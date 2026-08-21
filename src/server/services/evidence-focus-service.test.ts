import { describe, expect, it } from "vitest";
import type { GenerateRequest, GenerateResult, LLMProvider } from "../llm-provider.js";
import { DemoLLMProvider } from "../llm-provider.js";
import { Store } from "../store.js";
import { focusEvidenceSnippet } from "./evidence-focus-service.js";

class StubProvider implements LLMProvider {
  requests: GenerateRequest[] = [];
  constructor(private readonly replies: Array<string | Error>) {}

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    this.requests.push(request);
    const reply = this.replies.shift();
    if (reply instanceof Error) throw reply;
    return { text: reply ?? JSON.stringify({ snippet: "" }), provider: "stub" };
  }
}

const fixture = (id: string) => {
  const store = new Store();
  const projectId = `project-${id}`;
  const documentId = `document-${id}`;
  const evidenceId = `evidence-${id}`;
  store.data.projects.push({ id: projectId, name: "Research", createdAt: "2026-01-01T00:00:00.000Z", profileConfirmed: true });
  store.data.documents.push({ id: documentId, projectId, fileName: "paper.pdf", kind: "pdf", role: "source", status: "parsed", uploadedAt: "2026-01-01T00:00:00.000Z" });
  store.data.blocks.push(
    { id: `before-${id}`, documentId, page: 1, blockType: "paragraph", text: "Previous context.", sourceLocation: "page 1" },
    { id: `main-${id}`, documentId, page: 2, blockType: "paragraph", text: "The catalyst increased conversion at 80 C. This is the relevant finding.", sourceLocation: "page 2" },
    { id: `after-${id}`, documentId, page: 3, blockType: "paragraph", text: "Following context.", sourceLocation: "page 3" },
  );
  store.data.evidence.push({ id: evidenceId, documentId, page: 2, blockId: `main-${id}`, originalText: store.data.blocks[1].text, status: "reported" });
  store.data.nodes.push({ id: `${projectId}:node`, canonicalName: "Catalyst", displayName: "Catalyst", type: "material", aliases: ["cat."], summary: "The catalyst's conversion effect.", properties: {}, importance: .8, confidence: .8, evidenceIds: [evidenceId] });
  return { store, projectId, evidenceId };
};

describe("focusEvidenceSnippet", () => {
  it("returns a validated semantic focus and includes neighboring blocks in the prompt", async () => {
    const { store, projectId, evidenceId } = fixture("focus");
    const provider = new StubProvider([JSON.stringify({ snippet: "The catalyst increased conversion at 80 C." })]);

    await expect(focusEvidenceSnippet(store, projectId, evidenceId, provider)).resolves.toBe("The catalyst increased conversion at 80 C.");
    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0].prompt).toContain("Previous context.");
    expect(provider.requests[0].prompt).toContain("Following context.");
    expect(provider.requests[0].prompt).toContain("Catalyst");
  });

  it("caches both the focus result and provider call by evidence id", async () => {
    const { store, projectId, evidenceId } = fixture("cache");
    const provider = new StubProvider([JSON.stringify({ snippet: "The catalyst increased conversion at 80 C." })]);

    await focusEvidenceSnippet(store, projectId, evidenceId, provider);
    await expect(focusEvidenceSnippet(store, projectId, evidenceId, provider)).resolves.toBe("The catalyst increased conversion at 80 C.");
    expect(provider.requests).toHaveLength(1);
  });

  it("repairs malformed structured output before accepting a source quote", async () => {
    const { store, projectId, evidenceId } = fixture("schema");
    const provider = new StubProvider([JSON.stringify({ snippet: 42 }), JSON.stringify({ snippet: "This is the relevant finding." })]);

    await expect(focusEvidenceSnippet(store, projectId, evidenceId, provider)).resolves.toBe("This is the relevant finding.");
    expect(provider.requests).toHaveLength(2);
  });

  it("returns null when no graph node cites the evidence", async () => {
    const { store, projectId, evidenceId } = fixture("unlinked");
    store.data.nodes.length = 0;
    const provider = new StubProvider([]);

    await expect(focusEvidenceSnippet(store, projectId, evidenceId, provider)).resolves.toBeNull();
    expect(provider.requests).toHaveLength(0);
  });

  it("returns null without calling the local demo provider", async () => {
    const { store, projectId, evidenceId } = fixture("demo");
    await expect(focusEvidenceSnippet(store, projectId, evidenceId, new DemoLLMProvider())).resolves.toBeNull();
  });

  it("safely falls back when the provider fails or invents a quote", async () => {
    const failing = fixture("failure");
    await expect(focusEvidenceSnippet(failing.store, failing.projectId, failing.evidenceId, new StubProvider([new Error("unavailable")]))).resolves.toBeNull();

    const invented = fixture("invented");
    await expect(focusEvidenceSnippet(invented.store, invented.projectId, invented.evidenceId, new StubProvider([JSON.stringify({ snippet: "Invented conclusion." })]))).resolves.toBeNull();
  });

  it("accepts a semantic quote whose words are interleaved by a two-column PDF extraction", async () => {
    const { store, projectId, evidenceId } = fixture("columns");
    store.data.blocks[1].text = "obtained LiFePO4/C using precursors I, II, chemical performance of LiFePO4/C is closely related to the III, and IV were defined as LiFePO4/C-I respectively.";
    const snippet = "precursors I, II, III, and IV were defined as LiFePO4/C-I";
    await expect(focusEvidenceSnippet(store, projectId, evidenceId, new StubProvider([JSON.stringify({ snippet })]))).resolves.toBe(snippet);
  });

  it("accepts equivalent Unicode and ASCII hyphen forms on the strict path", async () => {
    const { store, projectId, evidenceId } = fixture("hyphen");
    store.data.blocks[1].text = "The material LiFePO4/C–I showed improved performance.";
    const snippet = "LiFePO4/C-I showed improved performance.";
    await expect(focusEvidenceSnippet(store, projectId, evidenceId, new StubProvider([JSON.stringify({ snippet })]))).resolves.toBe(snippet);
  });
});

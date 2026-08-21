import { loadLocalEnv } from "./load-env.js";
loadLocalEnv();
import cors from "cors";
import express from "express";
import multer from "multer";
import path from "node:path";
import { stat, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { CreateProjectSchema, UpdateProfileSchema, type DocumentRecord, type ProjectSnapshot } from "../shared/contracts.js";
import { rememberPresetProfile } from "../shared/preset-profiles.js";
import { Store } from "./store.js";
import { recoverInterruptedJobs, runProjectJob } from "./job-runner.js";
import { removeDocumentKnowledge } from "./services/graph-service.js";
import { parseDocumentFile } from "./document-parser.js";
import { createLLMProvider, profileFromText } from "./llm-provider.js";
import { createChatRouter, chatErrorStatus } from "./routes/chat-routes.js";
import { focusEvidenceSnippet } from "./services/evidence-focus-service.js";

const app = express(); const store = new Store(); await store.load(); await recoverInterruptedJobs(store);
const uploadDir = path.resolve("uploads");
const upload = multer({ dest: uploadDir, limits: { fileSize: 20 * 1024 * 1024 } });
app.use(cors()); app.use(express.json()); app.use("/uploads", express.static(path.resolve("uploads")));
app.get("/api/ai-status", (_req, res) => res.json({ provider: process.env.DEEPSEEK_API_KEY?.trim() ? "deepseek" : "demo", configured: Boolean(process.env.DEEPSEEK_API_KEY?.trim()) }));
const snapshot = (projectId: string): ProjectSnapshot | undefined => { const project = store.data.projects.find(p => p.id === projectId); if (!project) return; return { project, documents: store.data.documents.filter(d => d.projectId === projectId), job: store.data.jobs.filter(j => j.projectId === projectId).at(-1), nodes: store.data.nodes.filter(n => n.id.startsWith(`${projectId}:`)), edges: store.data.edges.filter(e => e.id.startsWith(`${projectId}:`)), evidence: store.data.evidence.filter(e => store.data.documents.find(d => d.id === e.documentId)?.projectId === projectId) }; };
app.get("/api/projects", (_req, res) => res.json(store.data.projects));
app.post("/api/projects", async (req, res) => { const parsed = CreateProjectSchema.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() }); const now = new Date().toISOString(); const project = { id: randomUUID(), name: parsed.data.name, createdAt: now, updatedAt: now, profileConfirmed: false, wikiRevision: 0 }; store.data.projects.push(project); await store.save(); res.status(201).json(project); });
app.delete("/api/projects", async (req, res) => { const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter((id: unknown): id is string => typeof id === "string") : []; if (!ids.length) return res.status(400).json({ error: "Choose at least one project" }); const documents = store.data.documents.filter(d => ids.includes(d.projectId)); for (const doc of documents) if (doc.storagePath) await unlink(doc.storagePath).catch(() => undefined); const idSet = new Set(ids), documentIds = new Set(documents.map(d => d.id)), threadIds = new Set(store.data.chatThreads.filter(thread => idSet.has(thread.projectId)).map(thread => thread.id)); store.data.projects = store.data.projects.filter(p => !idSet.has(p.id)); store.data.documents = store.data.documents.filter(d => !idSet.has(d.projectId)); store.data.blocks = store.data.blocks.filter(b => !documentIds.has(b.documentId)); store.data.evidence = store.data.evidence.filter(e => !documentIds.has(e.documentId)); store.data.nodes = store.data.nodes.filter(n => !ids.some((id: string) => n.id.startsWith(`${id}:`))); store.data.edges = store.data.edges.filter(e => !ids.some((id: string) => e.id.startsWith(`${id}:`))); store.data.jobs = store.data.jobs.filter(j => !idSet.has(j.projectId)); store.data.chatThreads = store.data.chatThreads.filter(thread => !idSet.has(thread.projectId)); store.data.chatMessages = store.data.chatMessages.filter(message => !threadIds.has(message.threadId)); await store.save(); res.json({ deleted: idSet.size }); });
app.get("/api/projects/:id", (req, res) => { const data = snapshot(String(req.params.id)); return data ? res.json(data) : res.status(404).json({ error: "Project not found" }); });
app.get("/api/projects/:id/documents/:documentId/content", async (req, res) => {
  const projectId = String(req.params.id);
  const documentId = String(req.params.documentId);
  if (!store.data.projects.some(project => project.id === projectId)) {
    return res.status(404).json({ error: "Project not found" });
  }
  const document = store.data.documents.find(item => item.id === documentId);
  if (!document || document.projectId !== projectId) {
    return res.status(404).json({ error: "Document not found" });
  }
  if (!document.storagePath) {
    return res.status(404).json({ error: "Document content is unavailable" });
  }

  const filePath = path.resolve(document.storagePath);
  const relativePath = path.relative(uploadDir, filePath);
  if (path.isAbsolute(relativePath) || relativePath === ".." || relativePath.startsWith(`..${path.sep}`)) {
    return res.status(400).json({ error: "Document storage path is invalid" });
  }
  try {
    if (!(await stat(filePath)).isFile()) return res.status(404).json({ error: "Document file not found" });
  } catch {
    return res.status(404).json({ error: "Document file not found" });
  }

  res.setHeader("Content-Type", document.kind === "pdf"
    ? "application/pdf"
    : "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  res.setHeader("Content-Disposition", "inline");
  res.setHeader("X-Content-Type-Options", "nosniff");
  return res.sendFile(filePath, error => {
    if (error && !res.headersSent) res.status(500).json({ error: "Unable to read document" });
  });
});
app.put("/api/projects/:id/profile", async (req, res) => { const data = snapshot(String(req.params.id)); if (!data) return res.status(404).json({ error: "Project not found" }); const parsed = UpdateProfileSchema.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() }); const profileChanged = JSON.stringify(data.project.profile ?? null) !== JSON.stringify(parsed.data); data.project.profile = parsed.data; data.project.presetProfiles = rememberPresetProfile(data.project.presetProfiles, parsed.data); if (profileChanged) { data.project.profileConfirmed = false; data.project.rebuildRequired = true; delete data.project.generationPlan; data.project.updatedAt = new Date().toISOString(); } await store.save(); res.json(data.project); });
app.post("/api/projects/:id/upload", upload.single("file"), async (req, res) => { const data = snapshot(String(req.params.id)); const file = req.file; const role = req.body.role === "profile" ? "profile" : "source"; if (!data || !file) return res.status(400).json({ error: "Project and file are required" }); if (role === "source" && data.documents.filter(d => d.role === "source").length >= 30) return res.status(400).json({ error: "This MVP supports up to 30 source documents per project. Process or split larger collections into separate projects." }); const extension = path.extname(file.originalname).slice(1).toLowerCase(); if (!((role === "profile" && extension === "docx") || (role === "source" && ["pdf", "docx"].includes(extension)))) return res.status(400).json({ error: "Only DOCX profiles and PDF/DOCX source files are supported" }); const document: DocumentRecord = { id: randomUUID(), projectId: data.project.id, fileName: file.originalname.replace(/[^\w. -]/g, "_"), storagePath: file.path, kind: extension as "pdf" | "docx", role, status: "uploaded", uploadedAt: new Date().toISOString() }; store.data.documents.push(document); data.project.updatedAt = new Date().toISOString(); await store.save(); res.status(201).json(document); });
app.delete("/api/projects/:id/documents", async (req, res) => { const data = snapshot(String(req.params.id)); const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter((id: unknown): id is string => typeof id === "string") : []; if (!data || !ids.length) return res.status(400).json({ error: "Choose at least one document" }); const selected = store.data.documents.filter(d => d.projectId === data.project.id && ids.includes(d.id)); const selectedIds = new Set(selected.map(d => d.id)); for (const doc of selected) { if (doc.storagePath) await unlink(doc.storagePath).catch(() => undefined); } removeDocumentKnowledge(store.data, data.project.id, new Set(selected.filter(doc => doc.role === "source").map(doc => doc.id))); store.data.documents = store.data.documents.filter(d => !selectedIds.has(d.id)); if (selected.some(doc => doc.role === "profile")) data.project.profileConfirmed = false; if (selected.length) data.project.updatedAt = new Date().toISOString(); await store.save(); res.json({ deleted: selectedIds.size, project: data.project }); });
app.post("/api/projects/:id/profile/understand", async (req, res) => { const data = snapshot(String(req.params.id)); const profileDoc = data?.documents.filter(d => d.role === "profile").at(-1); if (!data || !profileDoc?.storagePath) return res.status(400).json({ error: "Upload a DOCX Research Profile first" }); try { const parsed = await parseDocumentFile(profileDoc.storagePath, "docx"); const profile = await profileFromText(parsed.blocks.map(b => b.text).join("\n")); data.project.profile = profile; data.project.presetProfiles = rememberPresetProfile(data.project.presetProfiles, profile); data.project.profileConfirmed = false; data.project.rebuildRequired = true; delete data.project.generationPlan; profileDoc.status = "parsed"; data.project.updatedAt = new Date().toISOString(); await store.save(); res.json({ profile, warnings: parsed.warnings }); } catch (error) { profileDoc.status = "failed"; profileDoc.error = error instanceof Error ? error.message : "Profile parsing failed"; await store.save(); res.status(422).json({ error: profileDoc.error }); } });
app.post("/api/projects/:id/confirm", async (req, res) => { const data = snapshot(req.params.id); if (!data?.project.profile) return res.status(400).json({ error: "A validated Wiki Profile is required" }); data.project.profileConfirmed = true; await store.save(); const job = await runProjectJob(store, data.project.id); res.status(202).json(job); });
app.get("/api/projects/:id/jobs/latest", (req, res) => { const projectId = String(req.params.id); if (!store.data.projects.some(project => project.id === projectId)) return res.status(404).json({ error: "Project not found" }); const job = store.data.jobs.filter(item => item.projectId === projectId).at(-1); return job ? res.json(job) : res.status(404).json({ error: "No processing job found" }); });
app.post("/api/projects/:id/evidence/focus", async (req, res) => { const data = snapshot(String(req.params.id)); if (!data) return res.status(404).json({ error: "Project not found" }); const parsed = z.object({ evidenceId: z.string().min(1) }).safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() }); if (!data.evidence.some(item => item.id === parsed.data.evidenceId)) return res.status(404).json({ error: "Evidence not found in this project" }); try { return res.json({ snippet: await focusEvidenceSnippet(store, data.project.id, parsed.data.evidenceId, createLLMProvider()) }); } catch { return res.json({ snippet: null }); } });
app.use("/api/projects/:id/chat", createChatRouter(store));
app.get("/api/projects/:id/search", (req, res) => { const data = snapshot(req.params.id); if (!data) return res.status(404).json({ error: "Project not found" }); const q = String(req.query.q ?? "").toLowerCase(); const nodes = data.nodes.filter(n => [n.displayName, n.canonicalName, n.summary, ...n.aliases].join(" ").toLowerCase().includes(q)); res.json({ nodes, edges: data.edges.filter(e => nodes.some(n => n.id === e.sourceNodeId || n.id === e.targetNodeId)), evidence: data.evidence }); });
app.get("/api/projects/:id/export/:format", (req, res) => { const data = snapshot(req.params.id); if (!data) return res.status(404).end(); if (req.params.format === "csv") { const rows = ["id,name,type,summary,confidence", ...data.nodes.map(n => [n.id, n.displayName, n.type, JSON.stringify(n.summary), n.confidence].join(","))]; res.type("text/csv").attachment(`${data.project.name}.csv`).send(rows.join("\n")); } else res.type("application/json").attachment(`${data.project.name}.json`).send(JSON.stringify(data, null, 2)); });
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => { res.status(chatErrorStatus(err) ?? 500).json({ error: err.message || "Unexpected server error" }); });
app.listen(Number(process.env.PORT ?? 3001), () => console.log("API listening on http://localhost:3001"));

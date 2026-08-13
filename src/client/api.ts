import type { DocumentRecord, ProcessingJob, Project, ProjectSnapshot, SearchResult, WikiProfile } from "../shared/contracts";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(body.error?.formErrors?.[0] ?? body.error ?? "Request failed");
  }
  return response.json() as Promise<T>;
}

export const api = {
  aiStatus: () => request<{ provider: "deepseek" | "demo"; configured: boolean }>("/api/ai-status"),
  projects: () => request<Project[]>("/api/projects"),
  deleteProjects: (ids: string[]) => request<{ deleted: number }>("/api/projects", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }) }),
  createProject: (name: string) => request<Project>("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }),
  snapshot: (id: string) => request<ProjectSnapshot>(`/api/projects/${id}`),
  updateProfile: (id: string, profile: WikiProfile) => request<Project>(`/api/projects/${id}/profile`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(profile) }),
  upload: async (id: string, file: File, role: "profile" | "source"): Promise<DocumentRecord> => {
    const form = new FormData(); form.set("file", file); form.set("role", role);
    return request(`/api/projects/${id}/upload`, { method: "POST", body: form });
  },
  deleteDocuments: (id: string, ids: string[]) => request<{ deleted: number }>(`/api/projects/${id}/documents`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }) }),
  understandProfile: (id: string) => request<{ profile: WikiProfile; warnings: string[] }>(`/api/projects/${id}/profile/understand`, { method: "POST" }),
  confirm: (id: string) => request<ProcessingJob>(`/api/projects/${id}/confirm`, { method: "POST" }),
  search: (id: string, q: string) => request<SearchResult>(`/api/projects/${id}/search?q=${encodeURIComponent(q)}`),
  exportUrl: (id: string, format: "json" | "csv") => `/api/projects/${id}/export/${format}`
};

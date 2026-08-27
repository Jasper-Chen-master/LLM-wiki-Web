import { useCallback, useEffect, useState } from "react";
import { Link, NavLink, Route, Routes, useLocation, useParams } from "react-router-dom";
import type { ProjectSnapshot } from "../../../shared/contracts";
import { Alert } from "../../components/ui";
import { useI18n } from "../../i18n";
import { api } from "../../api";
import { Overview } from "./Overview";
import { GraphView } from "../graph/GraphView";
import { SearchView } from "../search/SearchView";
import { ChatView } from "../chat/ChatView";

export function Workspace() {
  const { projectId = "" } = useParams();
  const location = useLocation();
  const { t } = useI18n();
  const [snapshot, setSnapshot] = useState<ProjectSnapshot>();
  const [error, setError] = useState("");
  const load = useCallback(
    () =>
      api
        .snapshot(projectId)
        .then(setSnapshot)
        .catch((e) => setError(e.message)),
    [projectId],
  );
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!snapshot?.job || ["completed", "failed"].includes(snapshot.job.status))
      return;
    const pollJob = async () => {
      try {
        const job = await api.latestJob(projectId);
        if (["completed", "failed"].includes(job.status)) await load();
        else setSnapshot((current) => current ? { ...current, job } : current);
      } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not refresh processing status"); }
    };
    const timer = window.setInterval(() => void pollJob(), 1_000);
    return () => window.clearInterval(timer);
  }, [snapshot?.job?.id, snapshot?.job?.status, projectId, load]);
  if (error)
    return (
      <main className="page">
        <Alert message={error} />
      </main>
    );
  if (!snapshot) return <main className="page muted">{t.opening}</main>;
  return (
    <div className="workspace">
      <aside className="sidebar">
        <Link className="logo" to="/">
          <span>✦</span>
          {t.brand}
        </Link>
        <div className="project-name">{snapshot.project.name}</div>
        <nav>
          <NavLink to={`/projects/${projectId}`} end>
            {t.overview}
          </NavLink>
          <NavLink to={`/projects/${projectId}/graph`}>
            {t.graph} <b>{snapshot.nodes.length}</b>
          </NavLink>
          <NavLink to={`/projects/${projectId}/search`}>{t.search}</NavLink>
          <NavLink to={`/projects/${projectId}/chat`}>{t.chat}</NavLink>
        </nav>
        <div className="sidebar-foot">
          {t.evidenceFirst}
          <br />
          {t.localWorkspace} · v0.1
        </div>
      </aside>
      <main className={`workspace-main ${location.pathname.endsWith("/chat") ? "chat-workspace-main" : location.pathname.endsWith("/search") ? "search-workspace-main" : ""}`}>
        <Routes>
          <Route
            index
            element={<Overview snapshot={snapshot} reload={load} />}
          />
          <Route path="graph" element={<GraphView snapshot={snapshot} />} />
          <Route path="search" element={<SearchView snapshot={snapshot} />} />
          <Route path="chat" element={<ChatView snapshot={snapshot} />} />
        </Routes>
      </main>
    </div>
  );
}

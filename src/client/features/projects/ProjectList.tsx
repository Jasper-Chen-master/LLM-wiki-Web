import { type FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { Project } from "../../../shared/contracts";
import { Alert, LanguageToggle } from "../../components/ui";
import { useI18n } from "../../i18n";
import { api } from "../../api";

export function ProjectList() {
  const { t } = useI18n();
  const [projects, setProjects] = useState<Project[]>([]),
    [name, setName] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(true),
    [selected, setSelected] = useState<string[]>([]);
  const navigate = useNavigate();
  const load = () =>
    api
      .projects()
      .then(setProjects)
      .catch((e) => setError(e.message))
      .finally(() => setBusy(false));
  useEffect(() => {
    void load();
  }, []);
  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    try {
      const project = await api.createProject(name);
      navigate(`/projects/${project.id}`);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const remove = async () => {
    if (!selected.length) return;
    try {
      await api.deleteProjects(selected);
      setSelected([]);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <main className="landing">
      <header className="brand">
        <span className="brand-mark">✦</span>
        {t.brand}
        <LanguageToggle />
      </header>
      <section className="hero">
        <p className="eyebrow">{t.eyebrow}</p>
        <h1>{t.hero}</h1>
        <p className="lede">{t.lede}</p>
        <form className="create-card" onSubmit={create}>
          <label htmlFor="project-name">{t.start}</label>
          <div>
            <input
              id="project-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t.example}
            />
            <button>
              {t.create} <span>→</span>
            </button>
          </div>
        </form>
        {error && <Alert message={error} />}
      </section>
      <section className="project-section">
        <div className="section-title">
          <h2>{t.projects}</h2>
          <div className="project-actions">
            <span>
              {projects.length} {t.total}
            </span>
            <button
              className="button danger"
              disabled={!selected.length}
              onClick={remove}
            >
              {t.delete} ({selected.length})
            </button>
          </div>
        </div>
        {busy ? (
          <p className="muted">{t.loading}</p>
        ) : projects.length ? (
          <div className="project-grid">
            {projects.map((project) => (
              <div className="project-card" key={project.id}>
                <input
                  className="project-check"
                  type="checkbox"
                  checked={selected.includes(project.id)}
                  onChange={() =>
                    setSelected((current) =>
                      current.includes(project.id)
                        ? current.filter((id) => id !== project.id)
                        : [...current, project.id],
                    )
                  }
                />
                <Link to={`/projects/${project.id}`}>
                  <div className="project-icon">◈</div>
                  <h3>{project.name}</h3>
                  <p>
                    {project.profileConfirmed
                      ? t.active
                      : project.profile
                        ? t.review
                        : t.setup}
                  </p>
                  <small>
                    {t.created}{" "}
                    {new Date(project.createdAt).toLocaleDateString()}
                  </small>
                  <small>{t.lastEdited} {new Date(project.updatedAt ?? project.createdAt).toLocaleString()}</small>
                  <span className="arrow">→</span>
                </Link>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-state">{t.empty}</div>
        )}
      </section>
    </main>
  );
}

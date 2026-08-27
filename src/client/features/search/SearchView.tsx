import { type FormEvent, type KeyboardEvent, useState } from "react";
import type { ProjectSnapshot, WikiNode } from "../../../shared/contracts";
import { PageHeader } from "../../components/ui";
import { useI18n } from "../../i18n";
import { api } from "../../api";

export function SearchView({ snapshot }: { snapshot: ProjectSnapshot }) {
  const { t } = useI18n();
  const [query, setQuery] = useState(""),
    [results, setResults] = useState<WikiNode[]>(snapshot.nodes);
  const search = async () => {
    const normalizedQuery = query.replace(/\s+/g, " ").trim();
    setResults((await api.search(snapshot.project.id, normalizedQuery)).nodes);
  };
  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    void search();
  };
  const onSearchKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void search();
  };
  return (
    <>
      <PageHeader
        title={t.searchKnowledge}
        subtitle={t.searchSub}
        actions={
          <a
            className="button ghost"
            href={api.exportUrl(snapshot.project.id, "csv")}
          >
            {t.exportCsv}
          </a>
        }
      />
      <section className="search-panel">
        <form className="search-form" onSubmit={submitSearch}>
          <textarea
            autoFocus
            rows={1}
            className="search-input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onSearchKeyDown}
            placeholder={t.searchHint}
          />
          <button className="button primary" type="submit">{t.search}</button>
        </form>
        <p className="muted">
          {results.length} {t.matching}
        </p>
        <div className="search-results">
          {results.map((node) => (
            <article key={node.id}>
              <div>
                <span className="type-pill">{node.type}</span>
                <h2>{node.displayName}</h2>
                <p>{node.summary || t.noSummary}</p>
                {node.aliases.length > 0 && (
                  <small>
                    {t.alsoKnown}: {node.aliases.join(", ")}
                  </small>
                )}
              </div>
              <div className="score">
                {Math.round(node.confidence * 100)}
                <small>{t.confidence}</small>
              </div>
            </article>
          ))}
          {!results.length && <div className="empty-state">{t.noResults}</div>}
        </div>
      </section>
    </>
  );
}


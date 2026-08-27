import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { ProjectSnapshot, WikiNode } from "../../../shared/contracts";
import { Metric, PageHeader } from "../../components/ui";
import { useI18n } from "../../i18n";
import { escapeHtml, renderStructuredValue } from "../../lib/rich-text";
import { TYPE_COLORS, layoutNodes } from "../../lib/graph-layout";

export function GraphView({ snapshot }: { snapshot: ProjectSnapshot }) {
  const { t, lang } = useI18n();
  const [selected, setSelected] = useState<WikiNode | undefined>(
    snapshot.nodes[0],
  );
  const [focus, setFocus] = useState<Record<string, { snippet: string | null; loading: boolean }>>({});
  const focusRef = useRef(focus);
  const [query, setQuery] = useState(""),
    [type, setType] = useState("all");
  const [zoom, setZoom] = useState(1),
    [pan, setPan] = useState({ x: 0, y: 0 });
  const viewRef = useRef({ zoom: 1, pan: { x: 0, y: 0 } });
  const dragRef = useRef<{ x: number; y: number } | undefined>(undefined);
  const types = useMemo(
    () =>
      [...new Set(snapshot.nodes.map((node) => node.type.trim()))].sort(),
    [snapshot.nodes],
  );
  const colorFor = (type: string) =>
    TYPE_COLORS[types.indexOf(type.trim()) % TYPE_COLORS.length];
  const nodes = useMemo(
    () =>
      snapshot.nodes.filter(
        (n) =>
          (type === "all" || n.type.trim() === type.trim()) &&
          `${n.displayName} ${n.summary}`
            .toLowerCase()
            .includes(query.toLowerCase()),
      ),
    [snapshot.nodes, type, query],
  );
  const shown = useMemo(() => new Set(nodes.map((n) => n.id)), [nodes]);
  const edges = useMemo(
    () =>
      snapshot.edges.filter(
        (e) => shown.has(e.sourceNodeId) && shown.has(e.targetNodeId),
      ),
    [snapshot.edges, shown],
  );
  const layout = useMemo(() => layoutNodes(nodes, edges), [nodes, edges]);
  const positions = layout.positions;
  const evidence = selected
    ? snapshot.evidence.filter((item) => selected.evidenceIds.includes(item.id))
    : [];
  useEffect(() => {
    const evidenceIds = selected?.evidenceIds ?? [];
    const missing = evidenceIds.filter(id => !(id in focusRef.current));
    if (!missing.length) return;

    const controller = new AbortController();
    let mounted = true;
    const pending = Object.fromEntries(missing.map(id => [id, { snippet: null, loading: true }]));
    focusRef.current = { ...focusRef.current, ...pending };
    setFocus(current => ({ ...current, ...pending }));
    void (async () => {
      await Promise.all(missing.map(async evidenceId => {
        try {
          const response = await fetch(`/api/projects/${snapshot.project.id}/evidence/focus`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ evidenceId }),
            signal: controller.signal,
          });
          const payload: unknown = await response.json();
          const snippet = typeof (payload as { snippet?: unknown }).snippet === "string"
            ? (payload as { snippet: string }).snippet.trim() || null
            : null;
          if (mounted) {
            const entry = { snippet, loading: false };
            focusRef.current = { ...focusRef.current, [evidenceId]: entry };
            setFocus(current => ({ ...current, [evidenceId]: entry }));
          }
        } catch {
          const entry = { snippet: null, loading: false };
          focusRef.current = { ...focusRef.current, [evidenceId]: entry };
          if (mounted) {
            setFocus(current => ({ ...current, [evidenceId]: entry }));
          }
        }
      }));
    })();
    return () => {
      mounted = false;
      controller.abort();
      const nextFocus = { ...focusRef.current };
      for (const evidenceId of missing) delete nextFocus[evidenceId];
      focusRef.current = nextFocus;
    };
  }, [selected?.id, selected?.evidenceIds, snapshot.project.id]);
  const docNames = useMemo(
    () => new Map(snapshot.documents.map((d) => [d.id, d.fileName])),
    [snapshot.documents],
  );
  const documentsById = useMemo(
    () => new Map(snapshot.documents.map((document) => [document.id, document])),
    [snapshot.documents],
  );
  const related = selected
    ? snapshot.nodes.filter(
        (n) =>
          n.id !== selected.id &&
          snapshot.edges.some(
            (e) =>
              (e.sourceNodeId === selected.id && e.targetNodeId === n.id) ||
              (e.targetNodeId === selected.id && e.sourceNodeId === n.id),
          ),
      )
    : [];
  const transform = `translate(${pan.x} ${pan.y}) scale(${zoom})`;
  const canvasRef = useRef<HTMLDivElement>(null);
  const updateView = useCallback((nextZoom: number, nextPan: { x: number; y: number }) => {
    viewRef.current = { zoom: nextZoom, pan: nextPan };
    setZoom(nextZoom);
    setPan(nextPan);
  }, []);
  useEffect(() => {
    // A filtered layout has a new viewBox. Resetting its transform lets SVG's centered
    // viewBox alignment place the reduced set in the middle instead of retaining old pan.
    updateView(1, { x: 0, y: 0 });
    setSelected(current => current && nodes.some(node => node.id === current.id) ? current : nodes[0]);
  }, [nodes, updateView]);
  useEffect(() => {
    const element = canvasRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const pointer = {
        x: (event.clientX - rect.left) * (layout.width / rect.width),
        y: (event.clientY - rect.top) * (layout.height / rect.height),
      };
      const current = viewRef.current;
      const nextZoom = Math.max(0.1, Math.min(20, current.zoom * (event.deltaY < 0 ? 1.12 : 0.89)));
      const worldPoint = {
        x: (pointer.x - current.pan.x) / current.zoom,
        y: (pointer.y - current.pan.y) / current.zoom,
      };
      updateView(nextZoom, {
        x: pointer.x - worldPoint.x * nextZoom,
        y: pointer.y - worldPoint.y * nextZoom,
      });
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [layout.height, layout.width]);
  return (
    <>
      <PageHeader
        title={t.graph}
        subtitle={t.graphSub}
        actions={
          <Link
            className="button ghost"
            to={`/projects/${snapshot.project.id}/search`}
          >
            {t.searchKnowledge}
          </Link>
        }
      />
      <div className="graph-toolbar">
        <input
          aria-label={t.find}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t.find}
        />
        <select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="all">{t.allTypes}</option>
          {types.map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
        <span>
          {nodes.length} {t.nodes} · {edges.length} {t.relationsCount}
        </span>
      </div>
      {!nodes.length ? (
        <div className="empty-state graph-empty">{t.graphEmpty}</div>
      ) : (
        <div className="graph-layout">
          <section className="graph-canvas" ref={canvasRef}>
            <div className="graph-legend">
              {types.map((legendType) => (
                <div className="legend-item" key={legendType}>
                  <span
                    className="legend-dot"
                    style={{ background: colorFor(legendType) }}
                  />
                  <span>{legendType}</span>
                </div>
              ))}
            </div>
            <svg
              viewBox={`0 0 ${layout.width} ${layout.height}`}
              onPointerDown={(e) => {
                e.preventDefault();
                dragRef.current = { x: e.clientX, y: e.clientY };
                e.currentTarget.setPointerCapture(e.pointerId);
              }}
              onPointerMove={(e) => {
                const drag = dragRef.current;
                if (drag) {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const current = viewRef.current;
                  updateView(current.zoom, {
                    x: current.pan.x + (e.clientX - drag.x) * (layout.width / rect.width),
                    y: current.pan.y + (e.clientY - drag.y) * (layout.height / rect.height),
                  });
                  dragRef.current = { x: e.clientX, y: e.clientY };
                }
              }}
              onPointerUp={(e) => {
                dragRef.current = undefined;
                e.currentTarget.releasePointerCapture(e.pointerId);
              }}
              onPointerCancel={() => { dragRef.current = undefined; }}
            >
              <g transform={transform}>
                {edges.map((edge) => {
                  const a = positions.get(edge.sourceNodeId),
                    b = positions.get(edge.targetNodeId);
                  return a && b ? (
                    <line
                      key={edge.id}
                      x1={a.x}
                      y1={a.y}
                      x2={b.x}
                      y2={b.y}
                      className={
                        edge.relationStatus === "inferred"
                          ? "graph-line inferred"
                          : "graph-line"
                      }
                    />
                  ) : null;
                })}
                {nodes.map((node) => {
                  const p = positions.get(node.id)!;
                  const active = selected?.id === node.id;
                  const radius = 6 + node.importance * 6;
                  const labelAnchor = p.x < layout.center.x - 4 ? "end" : p.x > layout.center.x + 4 ? "start" : "middle";
                  const labelX = p.x < layout.center.x - 4 ? -radius - 5 : p.x > layout.center.x + 4 ? radius + 5 : 0;
                  const labelY = Math.abs(p.x - layout.center.x) <= 4 ? (p.y < layout.center.y ? -radius - 6 : radius + 14) : 4;
                  return (
                    <g
                      key={node.id}
                      className="graph-node"
                      transform={`translate(${p.x} ${p.y})`}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        setSelected(node);
                      }}
                    >
                      <circle
                        r={active ? radius + 3 : radius}
                        fill={active ? "#152338" : colorFor(node.type)}
                        style={{ fill: active ? "#152338" : colorFor(node.type) }}
                        className={active ? "active" : ""}
                      />
                      {zoom >= 0.6 && (
                        <text x={labelX} y={labelY} textAnchor={labelAnchor}>
                          {node.displayName.slice(0, 24)}
                        </text>
                      )}
                    </g>
                  );
                })}
              </g>
            </svg>
          </section>
          <aside className="node-detail">
            {selected ? (
              <>
                <p className="eyebrow">{selected.type}</p>
                <h2>{selected.displayName}</h2>
                <p>{selected.summary || t.noSummary}</p>
                <Metric
                  label={t.confidence}
                  value={`${Math.round(selected.confidence * 100)}%`}
                />
                <Metric
                  label={t.importance}
                  value={`${Math.round(selected.importance * 100)}%`}
                />
                <h3>{t.properties}</h3>
                {Object.keys(selected.properties).length ? (
                  <dl>
                    {Object.entries(selected.properties).map(([key, value]) => (
                      <div key={key}>
                        <dt>{key}</dt>
                        <dd>{renderStructuredValue(String(value))}</dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <p className="muted">{t.noProperties}</p>
                )}
                <h3>{t.related}</h3>
                {related.length ? (
                  <div className="related-list">
                    {related.map((n) => (
                      <button
                        key={n.id}
                        className="related-chip"
                        onClick={() => setSelected(n)}
                      >
                        {n.displayName}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="muted">{t.noProperties}</p>
                )}
                <h3>{t.evidenceLabel}</h3>
                {evidence.length ? (
                  evidence.map((item) => (
                    <article className="evidence" key={item.id}>
                      <header>
                        <span className="evidence-src">
                          {docNames.get(item.documentId) ?? t.source}
                        </span>
                        {(() => {
                          const document = documentsById.get(item.documentId);
                          if (!document) return null;
                          const pageHash = document.kind === "pdf" ? `#page=${item.page}` : "";
                          return (
                            <a
                              className="evidence-open"
                              href={`/api/projects/${snapshot.project.id}/documents/${item.documentId}/content${pageHash}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {t.openSource}
                            </a>
                          );
                        })()}
                        <span className="evidence-page">{lang === "zh" ? `第 ${item.page} 页` : `${t.page} ${item.page}`}</span>
                        <span className="evidence-status">{item.status === "observed" ? t.observed : item.status === "inferred" ? t.inferred : t.reported}</span>
                      </header>
                      <p dangerouslySetInnerHTML={{
                        __html: escapeHtml(focus[item.id]?.snippet || item.originalText),
                      }} />
                      <small>{item.section ?? item.blockId}</small>
                    </article>
                  ))
                ) : (
                  <p className="muted">{t.noProperties}</p>
                )}
              </>
            ) : (
              <p className="muted">{t.selectNode}</p>
            )}
          </aside>
        </div>
      )}
    </>
  );
}



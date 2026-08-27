import { type ChangeEvent, useEffect, useRef, useState } from "react";
import { getSavedPresetProfile } from "../../../shared/preset-profiles";
import type { ProjectSnapshot, WikiProfile } from "../../../shared/contracts";
import { Alert, Field, PageHeader, Status, UploadBox } from "../../components/ui";
import { useI18n } from "../../i18n";
import { api } from "../../api";
import {
  PROFILE_SYNC_CHANNEL,
  PROFILE_SYNC_STORAGE_KEY,
  PRESET_TEMPLATES,
  TEMPLATE_PRESETS,
  emptyProfile,
  isProfileSyncMessage,
  listInputsFromProfile,
  overviewDrafts,
  publishProfileSync,
  split,
  templateForProfile,
  type PresetTemplateId,
  type ProfileListInputs,
} from "./profile-model";
import { JobPanel } from "./JobPanel";

export function Overview({
  snapshot,
  reload,
}: {
  snapshot: ProjectSnapshot;
  reload: () => void;
}) {
  const { t, lang } = useI18n();
  const { project } = snapshot;
  const projectId = project.id;
  const buildRunning = Boolean(snapshot.job && !["completed", "failed"].includes(snapshot.job.status));
  const initialProfile = overviewDrafts.get(projectId)?.profile ?? project.profile ?? emptyProfile;
  const [profile, setProfile] = useState<WikiProfile>(
    () => initialProfile,
  );
  const [profileDirty, setProfileDirtyState] = useState(() => Boolean(overviewDrafts.get(projectId)?.profileDirty));
  const profileDirtyRef = useRef(profileDirty);
  const profileSyncSeenRef = useRef("");
  const markProfileDirty = (dirty: boolean) => {
    profileDirtyRef.current = dirty;
    setProfileDirtyState(dirty);
  };
  // Keep the raw comma-separated strings while editing. Parsing on every keystroke
  // removes empty trailing items (especially after a comma) and causes cursor jumps.
  const [listInputs, setListInputs] = useState<ProfileListInputs>(() => {
    const draft = overviewDrafts.get(projectId);
    return draft?.listInputs ?? listInputsFromProfile(initialProfile);
  });
  const [saving, setSaving] = useState(false),
    [error, setError] = useState(""),
    [selected, setSelected] = useState<string[]>([]),
    [selectedTemplate, setSelectedTemplate] = useState<string>(
      () => overviewDrafts.get(projectId)?.selectedTemplate ?? templateForProfile(project.profile),
    ),
    [templateHint, setTemplateHint] = useState("");
  // 项目切换（snapshot 更新为新项目）时，重置为该项目的草稿或服务端 profile，避免串项目
  useEffect(() => {
    const draft = overviewDrafts.get(projectId);
    const nextProfile = draft?.profile ?? project.profile ?? emptyProfile;
    setProfile(nextProfile);
    setListInputs(draft?.listInputs ?? listInputsFromProfile(nextProfile));
    setSelectedTemplate(draft?.selectedTemplate ?? templateForProfile(project.profile));
    markProfileDirty(Boolean(draft?.profileDirty));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);
  useEffect(() => {
    overviewDrafts.set(projectId, { selectedTemplate, profile, listInputs, profileDirty });
  }, [projectId, selectedTemplate, profile, listInputs, profileDirty]);
  useEffect(() => {
    setSelected((previous) =>
      previous.filter((id) => snapshot.documents.some((d) => d.id === id)),
    );
  }, [snapshot.documents]);
  useEffect(() => {
    const applyRemoteProfile = (value: unknown) => {
      if (!isProfileSyncMessage(value) || value.projectId !== projectId || profileSyncSeenRef.current === value.id) return;
      profileSyncSeenRef.current = value.id;
      if (profileDirtyRef.current) {
        setTemplateHint(t.profileUpdatedElsewhere);
        return;
      }
      markProfileDirty(false);
      setProfile(value.profile);
      setListInputs(listInputsFromProfile(value.profile));
      setSelectedTemplate(templateForProfile(value.profile));
      setTemplateHint("");
      void reload();
    };
    if (typeof BroadcastChannel !== "undefined") {
      const channel = new BroadcastChannel(PROFILE_SYNC_CHANNEL);
      channel.onmessage = (event) => applyRemoteProfile(event.data);
      return () => channel.close();
    }
    const onStorage = (event: StorageEvent) => {
      if (event.key !== PROFILE_SYNC_STORAGE_KEY || !event.newValue) return;
      try { applyRemoteProfile(JSON.parse(event.newValue)); } catch { /* Ignore malformed browser events. */ }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [projectId, reload, t]);
  const prevLang = useRef(lang);
  useEffect(() => {
    if (prevLang.current === lang) return;
    prevLang.current = lang;
    if (selectedTemplate === "custom") {
      markProfileDirty(true);
      setProfile((current) => ({ ...current, outputLanguage: lang }));
      return;
    }
    const template = PRESET_TEMPLATES[selectedTemplate as keyof typeof PRESET_TEMPLATES];
    if (!template) return;
    const preset = TEMPLATE_PRESETS[selectedTemplate as PresetTemplateId];
    const saved = getSavedPresetProfile(project, preset, lang);
    const nextProfile = { ...(saved ?? template[lang]), preset, outputLanguage: lang };
    markProfileDirty(true);
    setProfile(nextProfile);
    setListInputs(listInputsFromProfile(nextProfile));
  }, [lang, selectedTemplate]);
  const update = (
    key: keyof WikiProfile,
    value: WikiProfile[keyof WikiProfile],
  ) => {
    markProfileDirty(true);
    setProfile((previous) => ({ ...previous, [key]: value }));
  };
  const applyTemplate = async (templateId: PresetTemplateId) => {
    const preset = TEMPLATE_PRESETS[templateId];
    const template = getSavedPresetProfile(project, preset, lang) ?? PRESET_TEMPLATES[templateId][lang];
    markProfileDirty(true);
    setSelectedTemplate(templateId);
    const nextProfile = { ...template, preset, outputLanguage: lang };
    setProfile(nextProfile);
    setListInputs(listInputsFromProfile(nextProfile));
    setTemplateHint(
      snapshot.documents.some((document) => document.role === "source")
        ? t.templateApplied
        : t.templateNoSources,
    );
  };
  const selectCustom = () => {
    markProfileDirty(true);
    setSelectedTemplate("custom");
    setTemplateHint(t.templateHint);
    const nextProfile: WikiProfile = { ...emptyProfile, preset: "custom", outputLanguage: lang };
    setProfile(nextProfile);
    setListInputs(listInputsFromProfile(nextProfile));
  };
  const upload = async (
    event: ChangeEvent<HTMLInputElement>,
    role: "profile" | "source",
  ) => {
    const files = event.target.files;
    if (!files?.length) return;
    try {
      for (const file of Array.from(files))
        await api.upload(project.id, file, role);
      if (role === "profile") {
        const understood = await api.understandProfile(project.id);
        markProfileDirty(false);
        setProfile(understood.profile);
        setListInputs(listInputsFromProfile(understood.profile));
        setSelectedTemplate(templateForProfile(understood.profile));
        publishProfileSync(project.id, understood.profile);
      }
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      event.target.value = "";
    }
  };
  const save = async () => {
    setSaving(true);
    try {
      const savedProfile = { ...profile, outputLanguage: lang };
      setProfile(savedProfile);
      const savedProject = await api.updateProfile(project.id, savedProfile);
      markProfileDirty(false);
      if (savedProject.profile) publishProfileSync(project.id, savedProject.profile);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  const confirm = async () => {
    if (buildRunning) return;
    setSaving(true);
    try {
      const savedProfile = { ...profile, outputLanguage: lang };
      setProfile(savedProfile);
      const savedProject = await api.updateProfile(project.id, savedProfile);
      markProfileDirty(false);
      if (savedProject.profile) publishProfileSync(project.id, savedProject.profile);
      await api.confirm(project.id);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  const remove = async () => {
    if (!selected.length) return;
    setSaving(true);
    try {
      await api.deleteDocuments(project.id, selected);
      setSelected([]);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  const toggle = (id: string) =>
    setSelected((current) =>
      current.includes(id)
        ? current.filter((value) => value !== id)
        : [...current, id],
    );
  return (
    <>
      <PageHeader
        title={t.workspace}
        subtitle={t.workspaceSub}
        actions={
          <>
            <a
              className="button ghost"
              href={api.exportUrl(project.id, "json")}
            >
              {t.exportJson}
            </a>
            <a className="button ghost" href={api.exportUrl(project.id, "csv")}>
              {t.exportCsv}
            </a>
          </>
        }
      />
      {error && <Alert message={error} />}
      <div className="overview-grid">
        <section className="panel profile-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">01 · {t.profile}</p>
              <h2>{t.guide}</h2>
            </div>
            <Status
              label={
                project.profileConfirmed
                  ? t.confirmed
                  : project.profile
                    ? t.ready
                    : t.required
              }
              tone={project.profileConfirmed ? "good" : "pending"}
            />
          </div>
          <p className="help">{t.help}</p>
          <div className="template-picker" aria-label={t.templates}>
            <div>
              <span>{t.templates}</span>
              <small>{t.templateHint}</small>
            </div>
            <div className="template-chips">
              {([
                ["general", t.general],
                ["research", t.research],
                ["course", t.course],
                ["experimental", t.experimental],
                ["business", t.business],
              ] as const).map(([id, label]) => (
                <button key={id} type="button" className={selectedTemplate === id ? "selected" : ""} disabled={saving} onClick={() => void applyTemplate(id)}>{label}</button>
              ))}
              <button type="button" className={selectedTemplate === "custom" ? "selected" : ""} disabled={saving} onClick={selectCustom}>{t.custom}</button>
            </div>
          </div>
          {templateHint && <p className="template-help">{templateHint}</p>}
          <Field label={t.objective}>
            <textarea
              value={profile.researchGoal}
              onChange={(e) => update("researchGoal", e.target.value)}
              placeholder={t.objectiveHint}
            />
          </Field>
          <div className="field-row">
            <Field label={t.domain}>
              <input
                value={profile.domain}
                onChange={(e) => update("domain", e.target.value)}
              />
            </Field>
            <Field label={t.entityTypes}>
              <input
                value={listInputs.entityTypes}
                onChange={(e) => {
                  const value = e.target.value;
                  setListInputs((current) => ({ ...current, entityTypes: value }));
                  update("entityTypes", split(value));
                }}
                placeholder={t.entitiesHint}
              />
            </Field>
          </div>
          <div className="field-row">
            <Field label={t.relations}>
              <input
                value={listInputs.preferredRelations}
                onChange={(e) => {
                  const value = e.target.value;
                  setListInputs((current) => ({ ...current, preferredRelations: value }));
                  update("preferredRelations", split(value));
                }}
                placeholder={t.relationsHint}
              />
            </Field>
            <Field label={t.ignore}>
              <input
                value={listInputs.exclude}
                onChange={(e) => {
                  const value = e.target.value;
                  setListInputs((current) => ({ ...current, exclude: value }));
                  update("exclude", split(value));
                }}
                placeholder={t.ignoreHint}
              />
            </Field>
          </div>
          <Field label={t.customRequirements}>
            <textarea
              value={profile.customRequirements ?? ""}
              onChange={(e) => update("customRequirements", e.target.value)}
              placeholder={t.customRequirementsHint}
            />
          </Field>
          <div className="actions">
            <button className="button ghost" disabled={saving} onClick={save}>
              {t.save}
            </button>
            <button
              className="button primary"
              disabled={saving || buildRunning || !(profile.researchGoal ?? "").trim()}
              onClick={confirm}
            >
              {saving || buildRunning
                ? t.working
                : project.profileConfirmed
                  ? t.reprocess
                  : t.confirm}{" "}
              <span>→</span>
            </button>
          </div>
        </section>
        <section className="right-stack">
          <section className="panel upload-panel">
            <p className="eyebrow">02 · {t.sources}</p>
            <h2>{t.upload}</h2>
            <UploadBox
              label={t.profile}
              detail={t.profileDetail}
              accept=".docx"
              onChange={(e) => void upload(e, "profile")}
            />
            <UploadBox
              label={t.sources}
              detail={t.sourceDetail}
              accept=".pdf,.docx"
              multiple
              onChange={(e) => void upload(e, "source")}
            />
            <div className="document-actions">
              <span>
                {selected.length} {t.selected}
              </span>
              <button
                className="button danger"
                disabled={!selected.length || saving}
                onClick={remove}
              >
                {t.delete}
              </button>
            </div>
            <p className="selection-help">{t.deleteHelp}</p>
            <div className="document-list">
              {snapshot.documents.length ? (
                snapshot.documents.map((d) => (
                  <label className="document" key={d.id}>
                    <input
                      type="checkbox"
                      checked={selected.includes(d.id)}
                      onChange={() => toggle(d.id)}
                    />
                    <span className="doc-icon">{d.kind.toUpperCase()}</span>
                    <div>
                      <strong>{d.fileName}</strong>
                      <small>
                        {d.role === "profile" ? t.profileRole : t.source} ·{" "}
                        {d.status === "parsed" ? t.documentParsed : d.status === "failed" ? t.documentFailed : t.documentUploaded}
                      </small>
                    </div>
                  </label>
                ))
              ) : (
                <p className="muted">{t.noFiles}</p>
              )}
            </div>
          </section>
          <JobPanel snapshot={snapshot} />
        </section>
      </div>
    </>
  );
}


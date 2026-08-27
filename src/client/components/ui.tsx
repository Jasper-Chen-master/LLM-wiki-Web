import type { ChangeEvent } from "react";
import type * as React from "react";
import { useI18n } from "../i18n";

export function LanguageToggle() {
  const { lang, setLang, t } = useI18n();
  return (
    <button
      type="button"
      className="language-toggle"
      onClick={() => setLang(lang === "en" ? "zh" : "en")}
      aria-label={t.language}
    >
      <span className={lang === "en" ? "selected" : ""}>EN</span>
      <i>
        <b className={lang === "zh" ? "zh" : ""} />
      </i>
      <span className={lang === "zh" ? "selected" : ""}>中</span>
    </button>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle: string;
  actions?: React.ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      <div className="header-actions">
        {actions}
        <LanguageToggle />
      </div>
    </header>
  );
}
export function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
export function UploadBox(props: {
  label: string;
  detail: string;
  accept: string;
  multiple?: boolean;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  const { t } = useI18n();
  return (
    <label className="upload-box">
      <input
        type="file"
        accept={props.accept}
        multiple={props.multiple}
        onChange={props.onChange}
      />
      <span className="upload-icon">↑</span>
      <strong>{props.label}</strong>
      <small>{props.detail}</small>
      <em>{props.multiple ? t.chooseMany : t.choose}</em>
    </label>
  );
}
export function Status({ label, tone }: { label: string; tone: "good" | "pending" }) {
  return <span className={`status ${tone}`}>{label}</span>;
}
export function Alert({ message }: { message: string }) {
  return (
    <div className="alert" role="alert">
      {message}
    </div>
  );
}
export function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

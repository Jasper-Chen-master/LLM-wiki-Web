import { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { I18n, translationsFor, type Language } from "./i18n";
import { ProjectList } from "./features/projects/ProjectList";
import { Workspace } from "./features/workspace/Workspace";

/**
 * Application shell: language bootstrap plus top-level routing.
 * All screens live under src/client/features/*; shared UI atoms under components/,
 * framework-free helpers under lib/, and dictionaries under i18n/.
 */
export function App() {
  const [lang, setLang] = useState<Language>(() =>
    localStorage.getItem("llm-wiki-language") === "zh" ? "zh" : "en",
  );
  useEffect(() => {
    localStorage.setItem("llm-wiki-language", lang);
    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
  }, [lang]);
  return (
    <I18n.Provider value={{ lang, t: translationsFor(lang), setLang }}>
      <Routes>
        <Route path="/" element={<ProjectList />} />
        <Route path="/projects/:projectId/*" element={<Workspace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </I18n.Provider>
  );
}

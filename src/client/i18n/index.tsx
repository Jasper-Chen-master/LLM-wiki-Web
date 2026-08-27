import { createContext, useContext } from "react";
import { copy, templateCopy } from "./messages";

export type Language = "en" | "zh";

export type Copy = { [K in keyof typeof copy.en]: string } & {
  [K in keyof typeof templateCopy.en]: string;
};

/** Merged translation table for a language, shared by the provider and the default context. */
export function translationsFor(lang: Language): Copy {
  return { ...copy[lang], ...templateCopy[lang] };
}

const I18n = createContext<{
  lang: Language;
  t: Copy;
  setLang: (lang: Language) => void;
}>({
  lang: "en",
  t: translationsFor("en"),
  setLang: () => undefined,
});

export const useI18n = () => useContext(I18n);

export { I18n };

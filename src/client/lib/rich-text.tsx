// Side-effect imports must live in the one module that renders KaTeX output,
// so both the mhchem extension and the stylesheet load exactly once per bundle.
import "katex/contrib/mhchem/mhchem.js";
import "katex/dist/katex.min.css";
import katex from "katex";
import { toWikiLatex } from "../math-rendering";

/**
 * Renders chat/property text safely: plain text never reaches the DOM as HTML.
 * The only escape hatch is inline KaTeX output generated locally with
 * `trust: false`, so model-provided markup cannot inject raw HTML.
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function renderBareChemistry(content: string, keyPrefix: number) {
  return content.split(/(\n)/).map((line, lineIndex) => {
    if (line === "\n") return line;
    const colonMatch = line.match(/^(.*?[：:]\s*)(.+)$/u);
    const prefix = colonMatch?.[1] ?? "";
    let candidate = (colonMatch?.[2] ?? line).trim();
    const suffixMatch = candidate.match(/([。；;，,]+)$/u);
    const suffix = suffixMatch?.[1] ?? "";
    if (suffix) candidate = candidate.slice(0, -suffix.length).trimEnd();
    const hasReactionArrow = /(?:→|⇌|->|<=>)/u.test(candidate);
    const elementCount = candidate.match(/[A-Z][a-z]?/g)?.length ?? 0;
    if (!hasReactionArrow || elementCount < 2 || /[\p{Script=Han}]/u.test(candidate)) return line;
    const mhchem = candidate
      .replace(/⇌/gu, "<=>")
      .replace(/→/gu, "->")
      .replace(/\b([a-z])(?=[A-Z])/gu, "$1 ");
    const tex = `\\ce{${mhchem}}`;
    return <span key={`chem-${keyPrefix}-${lineIndex}`}>{prefix}<span className="chat-math" dangerouslySetInnerHTML={{ __html: katex.renderToString(tex, { throwOnError: false, trust: false }) }} />{suffix}</span>;
  });
}

export function normalizeChatMath(content: string) {
  const formulaLike = (value: string) =>
    !/[\p{Script=Han}]/u.test(value)
    && /(?:=|≈|≤|≥|≠|∝|\\(?:frac|sum|int|vec|mathbf|mathrm)\b|[A-Za-zα-ωΑ-Ω]\s*(?:_|^|[*/×]))/u.test(value);
  const toLatex = (value: string) => toWikiLatex(value)
    .replace(/²/gu, "^2")
    .replace(/³/gu, "^3")
    .replace(/·/gu, "\\cdot ");
  return content
    .replace(/\\\[([\s\S]+?)\\\]/gu, "$$$$$1$$$$")
    .replace(/\\\(([^$\n]+?)\\\)/gu, "$$$1$")
    .replace(/((?:公式|方程)(?:为|是)?\s*|(?:formula|equation)(?:\s+is)?\s*)([^。\n]+)(?=。|\n|$)/giu, (full, prefix: string, candidate: string) => {
      const trimmed = candidate.trim();
      return formulaLike(trimmed) ? `${prefix}$${toLatex(trimmed)}$` : full;
    });
}

export function renderChatText(content: string) {
  return normalizeChatMath(content).split(/(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$)/g).map((part, index) => {
    const display = part.startsWith("$$") && part.endsWith("$$");
    const inline = !display && part.startsWith("$") && part.endsWith("$");
    if (!display && !inline) return renderBareChemistry(part, index);
    const tex = part.slice(display ? 2 : 1, display ? -2 : -1).trim();
    return <span key={`${index}-${tex}`} className={display ? "chat-math display" : "chat-math"} dangerouslySetInnerHTML={{ __html: katex.renderToString(tex, { displayMode: display, throwOnError: false, trust: false }) }} />;
  });
}

// Earlier Wiki-chat records may contain IDs that were once returned in prose.
// Citations are rendered separately, so hide implementation identifiers without
// changing the saved message or the server-side evidence binding.
export function readableChatContent(content: string) {
  const taggedIdentifier = String.raw`(?:(?:node|evidence)(?:\s*id)?|节点|证据)\s*[:：#]?\s*[a-z0-9][a-z0-9:_-]{7,}`;
  return content
    .replace(new RegExp(String.raw`[（(]\s*(?:${taggedIdentifier}\s*[,，、;；]?\s*)+[）)]`, "giu"), "")
    .replace(new RegExp(taggedIdentifier, "giu"), "")
    .replace(/\b[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\b/giu, "")
    .replace(/[（(]\s*[,，、;；\s]*[）)]/gu, "")
    .replace(/[，,、]\s*[，,、]+/gu, "，")
    .replace(/\s{2,}/gu, " ")
    .trim();
}

export function renderStructuredValue(content: string) {
  const mathSignal = content.search(/[=<>≈≤≥≠∝∑∫√αβγΔθλμπρτφω]/u);
  if (mathSignal < 0) return content;
  const prefixEnd = Math.max(
    content.lastIndexOf("，", mathSignal),
    content.lastIndexOf("：", mathSignal),
    content.lastIndexOf("；", mathSignal),
  );
  const prefix = prefixEnd >= 0 ? content.slice(0, prefixEnd + 1) : "";
  const candidate = content.slice(prefixEnd + 1).trim();
  if (!candidate || /[\p{Script=Han}]/u.test(candidate)) return content;
  const html = katex.renderToString(toWikiLatex(candidate), {
    throwOnError: false,
    trust: false,
    strict: "ignore",
  });
  return <>{prefix}<span className="structured-math" dangerouslySetInnerHTML={{ __html: html }} /></>;
}

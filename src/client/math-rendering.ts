/**
 * Normalizes common plain-text math into TeX without joining a control word to the
 * following variable. For example, replacing `Δ` naively in `Δt` produces `\Deltat`,
 * which KaTeX treats as an unknown command instead of `\Delta t`.
 */
const GREEK: Record<string, string> = {
  α: "\\alpha", β: "\\beta", γ: "\\gamma", Δ: "\\Delta", θ: "\\theta",
  λ: "\\lambda", μ: "\\mu", π: "\\pi", ρ: "\\rho", τ: "\\tau", φ: "\\phi", ω: "\\omega",
};

const unicodeGreek = /[αβγΔθλμπρτφω]/gu;
const unicodeGreekBeforeLatin = /[αβγΔθλμπρτφω](?=[A-Za-z])/gu;
const compactGreekCommand = /\\(alpha|beta|gamma|Delta|theta|lambda|mu|pi|rho|tau|phi|omega)([A-Za-z])/g;

export function toWikiLatex(formula: string) {
  return formula
    // Delimit Unicode Greek variables before converting them to TeX control words.
    .replace(unicodeGreekBeforeLatin, symbol => `${GREEK[symbol]} `)
    .replace(unicodeGreek, symbol => GREEK[symbol])
    // Also repair already-written compact commands such as `\Deltat`.
    .replace(compactGreekCommand, "\\$1 $2")
    .replace(/_([A-Za-z0-9]+(?:,[A-Za-z0-9]+)?)/g, "_{$1}")
    .replace(/\*/g, "\\cdot ")
    .replace(/≈/g, "\\approx ")
    .replace(/≤/g, "\\le ")
    .replace(/≥/g, "\\ge ")
    .replace(/≠/g, "\\ne ")
    .replace(/∝/g, "\\propto ")
    .replace(/√/g, "\\sqrt ");
}

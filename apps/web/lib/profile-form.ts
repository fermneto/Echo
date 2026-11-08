/**
 * Formulário "Editar perfil" da ficha: cargo e listas separadas por vírgula ou linha. A validação de verdade
 * (limites e nenhum dado pessoal) é `cleanProfile`, a mesma do currículo.
 */

export type ProfileInput = { jobTitle: string | null; skills: string[]; areas: string[]; languages: string[] };

export type PerfilState = { status: "idle" } | { status: "error"; error: string } | { status: "saved"; profile: ProfileInput; dropped: number };

const list = (v: FormDataEntryValue | null) =>
  String(v ?? "")
    .split(/[,\n;]/)
    .map((s) => s.trim())
    .filter(Boolean);

export function parseProfileForm(form: FormData): ProfileInput {
  const title = String(form.get("cargo") ?? "").trim();
  return { jobTitle: title || null, skills: list(form.get("habilidades")), areas: list(form.get("areas")), languages: list(form.get("idiomas")) };
}

/** Quantos itens o validador descartou (repetidos, longos demais ou com dado pessoal), para avisar na tela. */
export function droppedCount(input: ProfileInput, kept: ProfileInput): number {
  const n = (p: ProfileInput) => (p.jobTitle ? 1 : 0) + p.skills.length + p.areas.length + p.languages.length;
  return Math.max(0, n(input) - n(kept));
}

import type { AvatarTraits, PersonRole } from "@echo/domain";
import { extractText } from "unpdf";

/**
 * Formulário de cadastro do RH (Configuração): validação dos campos e dos arquivos antes do fluxo
 * `onboardPerson`. Currículo e foto ficam só na memória do pedido.
 */

export const ZONES: readonly { tz: string; label: string }[] = [
  { tz: "America/Sao_Paulo", label: "São Paulo (UTC−3)" },
  { tz: "America/Fortaleza", label: "Fortaleza (UTC−3)" },
  { tz: "America/Manaus", label: "Manaus (UTC−4)" },
  { tz: "America/Mexico_City", label: "Cidade do México (UTC−6)" },
  { tz: "America/New_York", label: "Nova York (UTC−5)" },
  { tz: "Europe/Lisbon", label: "Lisboa (UTC+0)" },
  { tz: "Europe/Berlin", label: "Berlim (UTC+1)" },
  { tz: "Africa/Lagos", label: "Lagos (UTC+1)" },
  { tz: "Africa/Johannesburg", label: "Joanesburgo (UTC+2)" },
  { tz: "Asia/Kolkata", label: "Bangalore (UTC+5:30)" },
  { tz: "Asia/Singapore", label: "Singapura (UTC+8)" },
  { tz: "Asia/Tokyo", label: "Tóquio (UTC+9)" },
  { tz: "Australia/Sydney", label: "Sydney (UTC+10)" },
];

export const ROLE_OPTIONS: readonly { value: PersonRole; label: string }[] = [
  { value: "member", label: "Pessoa da equipe" },
  { value: "leader", label: "Liderança" },
  { value: "hr", label: "RH" },
];

export const PHOTO_ACCEPT = "image/png,image/jpeg,image/webp";
export const RESUME_ACCEPT = ".pdf,.txt,.md,application/pdf,text/plain,text/markdown";
const PHOTO_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
const PHOTO_MAX = 4 * 1024 * 1024;
const RESUME_MAX = 200 * 1024;
const RESUME_PDF_MAX = 2 * 1024 * 1024;
const RESUME_MAX_CHARS = 12_000;
const HOUR = /^([01]\d|2[0-3]):[0-5]\d$/;

export type OnboardingFields = {
  name: string;
  role: PersonRole;
  timezone: string;
  workHours: { days: number[]; start: string; end: string };
  resumeText?: string;
  photo?: { mediaType: (typeof PHOTO_TYPES)[number]; base64: string };
};

export type CadastroState =
  | { status: "idle" }
  | { status: "error"; error: string }
  | {
      status: "done";
      name: string;
      avatar: AvatarTraits;
      jobTitle: string | null;
      skills: string[];
      areas: string[];
      languages: string[];
      /** Frases curtas sobre o que veio do modelo e o que ficou por regra. */
      notes: string[];
      saved: boolean;
    };

const isFile = (v: FormDataEntryValue | null): v is File => typeof v === "object" && v !== null && "arrayBuffer" in v && v.size > 0;

/**
 * Texto do PDF, só em memória: nada é gravado nem logado. Devolve `null` se o arquivo não abre como PDF.
 * O erro da biblioteca é descartado de propósito, porque pode trazer trechos do arquivo.
 */
async function pdfText(file: File): Promise<string | null> {
  try {
    const { text } = await extractText(new Uint8Array(await file.arrayBuffer()), { mergePages: true });
    return text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  } catch {
    return null;
  }
}

/** Lê e confere o formulário. Devolve o erro em português para a tela, ou os campos prontos para o fluxo. */
export async function parseOnboardingForm(form: FormData): Promise<{ ok: true; fields: OnboardingFields } | { ok: false; error: string }> {
  const name = String(form.get("nome") ?? "").replace(/\s+/g, " ").trim();
  if (!name) return { ok: false, error: "Escreva o nome da pessoa." };
  if (name.length > 80) return { ok: false, error: "Nome com mais de 80 caracteres." };

  const role = String(form.get("papel") ?? "member") as PersonRole;
  if (!ROLE_OPTIONS.some((r) => r.value === role)) return { ok: false, error: "Papel desconhecido." };

  const timezone = String(form.get("fuso") ?? "");
  if (!ZONES.some((z) => z.tz === timezone)) return { ok: false, error: "Escolha o fuso da pessoa." };

  const start = String(form.get("inicio") ?? "09:00");
  const end = String(form.get("fim") ?? "18:00");
  if (!HOUR.test(start) || !HOUR.test(end) || start >= end) return { ok: false, error: "Expediente inválido: o início vem antes do fim." };
  const days = form
    .getAll("dias")
    .map((d) => Number(d))
    .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
  if (!days.length) return { ok: false, error: "Marque pelo menos um dia de expediente." };

  const fields: OnboardingFields = { name, role, timezone, workHours: { days: [...new Set(days)].sort(), start, end } };

  const pasted = String(form.get("curriculo_texto") ?? "").trim();
  const resumeFile = form.get("curriculo");
  if (isFile(resumeFile)) {
    if (/\.pdf$/i.test(resumeFile.name) || resumeFile.type === "application/pdf") {
      if (resumeFile.size > RESUME_PDF_MAX) return { ok: false, error: "Currículo em PDF maior que 2 MB." };
      const text = await pdfText(resumeFile);
      if (text === null) return { ok: false, error: "Não deu para ler o PDF do currículo. Envie outro arquivo ou cole o texto." };
      if (!text) return { ok: false, error: "O PDF do currículo não tem texto (talvez seja só imagem). Cole o texto no campo." };
      fields.resumeText = text.slice(0, RESUME_MAX_CHARS);
    } else {
      if (resumeFile.size > RESUME_MAX) return { ok: false, error: "Currículo em texto maior que 200 KB." };
      if (!/\.(txt|md)$/i.test(resumeFile.name) && !/^text\//.test(resumeFile.type)) return { ok: false, error: "O currículo entra em PDF, .txt, .md ou colado no campo." };
      fields.resumeText = (await resumeFile.text()).slice(0, RESUME_MAX_CHARS);
    }
  } else if (pasted) {
    fields.resumeText = pasted.slice(0, RESUME_MAX_CHARS);
  }

  const photo = form.get("foto");
  if (isFile(photo)) {
    if (!(PHOTO_TYPES as readonly string[]).includes(photo.type)) return { ok: false, error: "A foto precisa ser PNG, JPEG ou WebP." };
    if (photo.size > PHOTO_MAX) return { ok: false, error: "Foto maior que 4 MB." };
    fields.photo = { mediaType: photo.type as (typeof PHOTO_TYPES)[number], base64: Buffer.from(await photo.arrayBuffer()).toString("base64") };
  }
  return { ok: true, fields };
}

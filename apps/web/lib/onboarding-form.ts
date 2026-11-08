import type { PersonRole } from "@echo/domain";
import { extractText } from "unpdf";
import { ROLE_OPTIONS } from "./onboarding-options";
import { ZONES } from "./zones";

/**
 * Formulário de cadastro do RH (Configuração): validação dos campos e dos arquivos antes do fluxo
 * `onboardPerson`. Currículo e foto ficam só na memória do pedido.
 */

const PHOTO_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
const PHOTO_MAX = 4 * 1024 * 1024;
const RESUME_MAX = 200 * 1024;
const RESUME_PDF_MAX = 2 * 1024 * 1024;
const RESUME_MAX_CHARS = 12_000;
const HOUR = /^([01]\d|2[0-3]):[0-5]\d$/;

export type OnboardingFields = {
  name: string;
  role: PersonRole;
  teamId?: string;
  timezone: string;
  workHours: { days: number[]; start: string; end: string };
  resumeText?: string;
  photo?: { mediaType: (typeof PHOTO_TYPES)[number]; base64: string };
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

/**
 * Lê e confere o formulário. Devolve o erro em português para a tela, ou os campos prontos para o fluxo.
 * `teamIds` são as equipes da empresa: quem não é do RH precisa de uma, senão não aparece para ninguém.
 */
export async function parseOnboardingForm(form: FormData, teamIds: readonly string[] = []): Promise<{ ok: true; fields: OnboardingFields } | { ok: false; error: string }> {
  const name = String(form.get("nome") ?? "").replace(/\s+/g, " ").trim();
  if (!name) return { ok: false, error: "Escreva o nome da pessoa." };
  if (name.length > 80) return { ok: false, error: "Nome com mais de 80 caracteres." };

  const role = String(form.get("papel") ?? "member") as PersonRole;
  if (!ROLE_OPTIONS.some((r) => r.value === role)) return { ok: false, error: "Papel desconhecido." };

  const teamId = String(form.get("equipe") ?? "");
  if (teamId && !teamIds.includes(teamId)) return { ok: false, error: "Equipe desconhecida." };
  if (!teamId && role !== "hr" && teamIds.length) return { ok: false, error: "Escolha a equipe da pessoa." };

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

  const fields: OnboardingFields = { name, role, ...(teamId ? { teamId } : {}), timezone, workHours: { days: [...new Set(days)].sort(), start, end } };

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

  const photo = await parsePhoto(form);
  if (typeof photo === "string") return { ok: false, error: photo };
  if (photo) fields.photo = photo;
  return { ok: true, fields };
}

/**
 * Foto do campo `foto`, em base64, só na memória do pedido. Devolve null sem arquivo, ou a mensagem de erro
 * em português. Usada no cadastro e ao refazer o bonequinho.
 */
export async function parsePhoto(form: FormData): Promise<{ mediaType: (typeof PHOTO_TYPES)[number]; base64: string } | null | string> {
  const photo = form.get("foto");
  if (!isFile(photo)) return null;
  if (!(PHOTO_TYPES as readonly string[]).includes(photo.type)) return "A foto precisa ser PNG, JPEG ou WebP.";
  if (photo.size > PHOTO_MAX) return "Foto maior que 4 MB.";
  return { mediaType: photo.type as (typeof PHOTO_TYPES)[number], base64: Buffer.from(await photo.arrayBuffer()).toString("base64") };
}

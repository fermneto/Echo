import { describe, expect, it } from "vitest";
import { parseOnboardingForm } from "./onboarding-form";

function form(fields: Record<string, string | string[] | File>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  return f;
}
/** PDF mínimo de uma página com as linhas dadas (Helvetica), com a tabela xref certa. Só dados sintéticos. */
function pdf(lines: string[]) {
  const stream = `BT /F1 12 Tf 72 720 Td 14 TL ${lines.map((l) => `(${l}) '`).join(" ")} ET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets = objs.map((o, i) => {
    const at = out.length;
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
    return at;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new File([out], "cv.pdf", { type: "application/pdf" });
}
const ok = { nome: " Marina   Teste ", papel: "member", fuso: "America/Sao_Paulo", inicio: "09:00", fim: "18:00", dias: ["1", "2", "3", "4", "5"] };

describe("cadastro do RH: formulário", () => {
  it("campos básicos, sem currículo nem foto", async () => {
    const r = await parseOnboardingForm(form(ok));
    expect(r).toEqual({ ok: true, fields: { name: "Marina Teste", role: "member", timezone: "America/Sao_Paulo", workHours: { days: [1, 2, 3, 4, 5], start: "09:00", end: "18:00" } } });
  });

  it("currículo colado ou em .txt, e foto em base64", async () => {
    const photo = new File([new Uint8Array([137, 80, 78, 71])], "m.png", { type: "image/png" });
    const r = await parseOnboardingForm(form({ ...ok, curriculo_texto: "Kotlin e Swift", foto: photo }));
    expect(r.ok && r.fields.resumeText).toBe("Kotlin e Swift");
    expect(r.ok && r.fields.photo).toEqual({ mediaType: "image/png", base64: "iVBORw==" });
    const file = new File(["React, Postgres"], "cv.txt", { type: "text/plain" });
    const r2 = await parseOnboardingForm(form({ ...ok, curriculo: file, curriculo_texto: "ignorado" }));
    expect(r2.ok && r2.fields.resumeText).toBe("React, Postgres");
  });

  it("currículo em PDF vira texto só em memória", async () => {
    const r = await parseOnboardingForm(form({ ...ok, curriculo: pdf(["Marina Teste", "Engenheira mobile", "Kotlin, Swift, CI"]) }));
    expect(r.ok && r.fields.resumeText).toMatch(/Engenheira mobile[\s\S]*Kotlin, Swift, CI/);
  });

  it("recusa o que não dá para usar", async () => {
    const err = async (f: Record<string, string | string[] | File>) => {
      const r = await parseOnboardingForm(form(f));
      return r.ok ? null : r.error;
    };
    expect(await err({ ...ok, nome: " " })).toBe("Escreva o nome da pessoa.");
    expect(await err({ ...ok, papel: "admin" })).toBe("Papel desconhecido.");
    expect(await err({ ...ok, fuso: "Marte/Olympus" })).toBe("Escolha o fuso da pessoa.");
    expect(await err({ ...ok, inicio: "18:00", fim: "09:00" })).toMatch(/Expediente inválido/);
    expect(await err({ ...ok, dias: [] })).toMatch(/pelo menos um dia/);
    expect(await err({ ...ok, foto: new File(["x"], "m.gif", { type: "image/gif" }) })).toBe("A foto precisa ser PNG, JPEG ou WebP.");
    expect(await err({ ...ok, foto: new File([new Uint8Array(5 * 1024 * 1024)], "m.png", { type: "image/png" }) })).toBe("Foto maior que 4 MB.");
    expect(await err({ ...ok, curriculo: new File(["%PDF-1.4 quebrado"], "cv.pdf", { type: "application/pdf" }) })).toMatch(/Não deu para ler o PDF/);
    expect(await err({ ...ok, curriculo: new File([new Uint8Array(2 * 1024 * 1024 + 1)], "cv.pdf", { type: "application/pdf" }) })).toBe("Currículo em PDF maior que 2 MB.");
    expect(await err({ ...ok, curriculo: new File(["x"], "cv.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }) })).toMatch(/PDF, \.txt, \.md/);
  });
  it("equipe: obrigatória para quem não é do RH, e só das equipes da empresa", async () => {
    const teams = ["t1", "t2"];
    const r = await parseOnboardingForm(form({ ...ok, equipe: "t2" }), teams);
    expect(r.ok && r.fields.teamId).toBe("t2");
    const missing = await parseOnboardingForm(form(ok), teams);
    expect(missing.ok ? null : missing.error).toBe("Escolha a equipe da pessoa.");
    const other = await parseOnboardingForm(form({ ...ok, equipe: "t9" }), teams);
    expect(other.ok ? null : other.error).toBe("Equipe desconhecida.");
    const hr = await parseOnboardingForm(form({ ...ok, papel: "hr" }), teams);
    expect(hr.ok && hr.fields.teamId).toBeUndefined();
  });
});

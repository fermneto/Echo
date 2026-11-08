import { cleanProfile } from "@echo/agents";
import { describe, expect, it } from "vitest";
import { droppedCount, parseProfileForm } from "./profile-form";

function form(fields: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  return f;
}

describe("editar perfil na ficha", () => {
  it("listas por vírgula, ponto e vírgula ou linha; cargo vazio vira nulo", () => {
    expect(parseProfileForm(form({ cargo: "  ", habilidades: "React, Postgres;\nKotlin", areas: "mobile", idiomas: "" }))).toEqual({ jobTitle: null, skills: ["React", "Postgres", "Kotlin"], areas: ["mobile"], languages: [] });
  });

  it("o validador do currículo descarta dado pessoal e repetido, e a tela conta quantos saíram", () => {
    const input = parseProfileForm(form({ cargo: "Designer", habilidades: "Figma, figma, (85) 98888-7777", areas: "mobile", idiomas: "Inglês, ana@exemplo.com" }));
    const kept = cleanProfile(input);
    expect(kept).toEqual({ jobTitle: "Designer", skills: ["Figma"], areas: ["mobile"], languages: ["inglês"] });
    expect(droppedCount(input, kept)).toBe(3);
  });
});

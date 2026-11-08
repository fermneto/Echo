// Vídeo da semana no Slack: quem recebe (equipe e liderança, sem RH, sem quem está ausente, sem quem não tem
// Slack) e o texto por regra.
import { describe, expect, it } from "vitest";
import { seesTeamVideo, teamVideoMessage, teamVideoRecipients } from "./team-video-delivery.ts";
import type { Person } from "./types.ts";

const wh = { days: [1, 2, 3, 4, 5], start: "09:00", end: "18:00" };
const person = (id: string, extra: Partial<Person> = {}): Person => ({ id, orgId: "o", name: id, role: "member", teamId: "t1", timezone: "America/Sao_Paulo", workHours: wh, skills: [], areas: [], active: true, ...extra });
// Sábado à noite em São Paulo: todos fora do expediente, e mesmo assim recebem.
const now = new Date("2026-11-07T23:00:00Z");

describe("vídeo da semana no Slack: quem recebe", () => {
  const people = [
    person("fer"),
    person("edu"),
    person("yan"),
    person("mar", { role: "leader" }),
    person("rh", { role: "hr", teamId: "t1" }),
    person("ina", { active: false }),
    person("ferias"),
    person("semslack"),
    person("outra", { teamId: "t2" }),
    person("lider-de-fora", { role: "leader", teamId: "t9" }),
  ];
  const slackIds = new Set(people.map((p) => p.id).filter((id) => id !== "semslack"));
  const absences = [
    { personId: "ferias", startsAt: new Date("2026-11-02T00:00:00Z"), endsAt: new Date("2026-11-20T00:00:00Z"), kind: "vacation" as const },
    // Ausência que já acabou não tira ninguém.
    { personId: "yan", startsAt: new Date("2026-10-01T00:00:00Z"), endsAt: new Date("2026-10-05T00:00:00Z"), kind: "leave" as const },
  ];

  it("ativos da equipe e a liderança; fora o RH, inativo, quem está de férias e quem não tem Slack; outra equipe nem aparece", () => {
    const r = teamVideoRecipients({ teamId: "t1", leaderId: "lider-de-fora", people, absences, slackIds, now });
    expect(r.to).toEqual(["fer", "edu", "yan", "mar", "lider-de-fora"]);
    expect(r.skipped).toEqual([
      { personId: "rh", reason: "rh" },
      { personId: "ina", reason: "inativo" },
      { personId: "ferias", reason: "ausente" },
      { personId: "semslack", reason: "sem_slack" },
    ]);
  });

  it("RH nunca recebe, nem cadastrado como líder da equipe; pessoa repetida entra uma vez", () => {
    const r = teamVideoRecipients({ teamId: "t1", leaderId: "rh", people: [person("fer"), person("fer"), person("rh", { role: "hr", teamId: undefined })], absences: [], slackIds: new Set(["fer", "rh"]), now });
    expect(r.to).toEqual(["fer"]);
    expect(r.skipped).toEqual([{ personId: "rh", reason: "rh" }]);
    expect(seesTeamVideo({ id: "rh", role: "hr", teamId: "t1" }, "t1")).toBe(false);
    expect(seesTeamVideo({ id: "x", role: "leader", teamId: "t2" }, "t1", "x")).toBe(true);
  });
});

describe("vídeo da semana no Slack: texto", () => {
  it("equipe, período, agente Claude e onde mais assistir; sem primeira pessoa nem ranking", () => {
    const m = teamVideoMessage({ teamName: "Produto", weekLabel: "2 a 6/11", week: "2026-W45", reportsUrl: "https://echo.exemplo.com/relatorios" });
    expect(m.filename).toBe("video-da-semana-2026-W45.mp4");
    expect(m.title).toBe("Vídeo da semana · Produto · 2 a 6/11");
    expect(m.comment).toBe("*Vídeo da semana da equipe Produto* · 2 a 6/11\nResumo animado da semana da equipe, gravado por um agente Claude (Powered by Claude). Também está no painel do Echo, em <https://echo.exemplo.com/relatorios|Relatórios>.");
    expect(m.text).toContain("Assista no painel do Echo, em <https://echo.exemplo.com/relatorios|Relatórios>.");
    for (const s of [m.comment, m.text]) expect(s).not.toMatch(/\b(eu|nós|meu|nosso|melhor|ranking|nota)\b/i);
  });

  it("sem endereço do painel, diz onde fica; nome da equipe não vira menção nem link", () => {
    const m = teamVideoMessage({ teamName: "<!channel> Pagamentos", weekLabel: "30/10 a 3/11", week: "2026-W44" });
    expect(m.text).toBe("*Vídeo da semana da equipe &lt;!channel&gt; Pagamentos* · 30/10 a 3/11\nResumo animado da semana da equipe, gravado por um agente Claude (Powered by Claude). Assista no painel do Echo, em Relatórios.");
  });
});

// Vídeo da semana no Slack: canal da equipe ou de reserva da empresa (sem canal, só no painel), id validado e
// texto por regra, sem menção a todos.
import { describe, expect, it } from "vitest";
import { parseSlackChannelId, teamVideoChannel, teamVideoMessage, teamVideoPostKey } from "./team-video-delivery.ts";

describe("vídeo da semana no Slack: canal", () => {
  it("id de canal público: C seguido de letras e números; o resto é recusado", () => {
    expect(parseSlackChannelId(" c0123abcd9 ")).toBe("C0123ABCD9");
    expect(parseSlackChannelId("C08ABCDEF12")).toBe("C08ABCDEF12");
    for (const bad of ["", null, undefined, "#geral", "U0123ABCD9", "D0123ABCD9", "G0123ABCD9", "C12", "C0123-ABCD", "https://x.slack.com/archives/C0123ABCD9"]) expect(parseSlackChannelId(bad)).toBeNull();
  });

  it("o da equipe; sem ele, o da empresa; sem nenhum, só no painel", () => {
    expect(teamVideoChannel({ teamChannel: "C0TEAM0001", orgChannel: "C0ORG00001" })).toBe("C0TEAM0001");
    expect(teamVideoChannel({ teamChannel: null, orgChannel: "C0ORG00001" })).toBe("C0ORG00001");
    expect(teamVideoChannel({ teamChannel: "lixo", orgChannel: "C0ORG00001" })).toBe("C0ORG00001");
    expect(teamVideoChannel({})).toBeNull();
    expect(teamVideoChannel({ teamChannel: "U0PESSOA01" })).toBeNull();
  });

  it("uma postagem por vídeo", () => {
    expect(teamVideoPostKey("v1")).toBe("team_video:v1:canal");
  });
});

describe("vídeo da semana no Slack: texto", () => {
  it("equipe, período, agente Claude, convite para a thread e onde mais assistir; sem primeira pessoa nem ranking", () => {
    const m = teamVideoMessage({ teamName: "Produto", weekLabel: "2 a 6/11", week: "2026-W45", reportsUrl: "https://echo.exemplo.com/relatorios" });
    expect(m.filename).toBe("video-da-semana-2026-W45.mp4");
    expect(m.title).toBe("Vídeo da semana · Produto · 2 a 6/11");
    expect(m.comment).toBe("*Vídeo da semana da equipe Produto* · 2 a 6/11\nResumo animado da semana, gravado por um agente Claude (Powered by Claude). Comentem aqui na thread. Também está no painel do Echo, em <https://echo.exemplo.com/relatorios|Relatórios>.");
    expect(m.text).toBe("*Vídeo da semana da equipe Produto* · 2 a 6/11\nResumo animado da semana, gravado por um agente Claude (Powered by Claude). Assista no painel do Echo, em <https://echo.exemplo.com/relatorios|Relatórios> e comentem aqui na thread.");
    for (const s of [m.comment, m.text]) expect(s).not.toMatch(/\b(eu|nós|meu|nosso|melhor|ranking|nota)\b|<!/i);
  });

  it("sem endereço do painel, diz onde fica; nome da equipe não vira menção, link nem aviso a todos", () => {
    const m = teamVideoMessage({ teamName: "<!channel> Pagamentos @here", weekLabel: "30/10 a 3/11", week: "2026-W44" });
    expect(m.comment).toBe("*Vídeo da semana da equipe &lt;!channel&gt; Pagamentos @​here* · 30/10 a 3/11\nResumo animado da semana, gravado por um agente Claude (Powered by Claude). Comentem aqui na thread. Também está no painel do Echo, em Relatórios.");
    expect(m.comment).not.toMatch(/<!|@here/);
  });
});

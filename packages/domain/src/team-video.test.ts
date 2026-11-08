// Vídeo da semana da equipe: cenas por regra, totais da equipe, textos sem ranking e gravação conferida.
import { describe, expect, it } from "vitest";
import type { AvatarTraits } from "./avatar.ts";
import { NARRATION_PAD_S, numbersNarration, planScenes, ruleTeamTexts, scenesSeconds, stretchScenes, TEAM_VIDEO_RULES, teamRecordingIssues, teamTextIssues, teamTotals, teamVideoDue, type TeamWeekFacts } from "./team-video.ts";

const a = { hair: "short", hairColor: "brown", skin: "s3", eyewear: "none", facialHair: "none", top: "tshirt", topColor: "blue", headwear: "none" } as AvatarTraits;
const facts: TeamWeekFacts = {
  teamName: "Produto",
  weekLabel: "2 a 6/11",
  people: [{ id: "fer", name: "Fernando", avatar: a }, { id: "car", name: "Carla", avatar: a }],
  deliveries: [{ ref: "ECH-128", title: "Tempo limite", personId: "fer" }, { ref: "echo/app#63", title: "Bonequinho", personId: "car" }],
  helps: [{ fromId: "car", toId: "fer", count: 2 }],
  twins: { answered: 7, peopleIds: ["fer"] },
  clips: [{ ref: "echo/app#63", title: "Tela", file: "clips/0.mp4" }],
};

describe("vídeo da semana: cenas", () => {
  it("totais da equipe, nunca por pessoa", () => {
    expect(teamTotals(facts)).toEqual({ deliveries: 2, helps: 2, answered: 7 });
  });
  it("cenas em ordem, com início e duração; sem conteúdo, a cena fica de fora", () => {
    const { scenes } = planScenes(facts, ruleTeamTexts(facts));
    expect(scenes.map((s) => s.kind)).toEqual(["opening", "numbers", "deliveries", "clip", "helps", "twins", "closing"]);
    expect(scenes[1]!.at).toBe(5);
    const empty = planScenes({ ...facts, deliveries: [], helps: [], twins: { answered: 0, peopleIds: [] }, clips: [] }, ruleTeamTexts(facts));
    expect(empty.scenes.map((s) => s.kind)).toEqual(["opening", "closing"]);
  });
  it("nunca passa de 90 s: trechos de tela saem do fim", () => {
    const many = { ...facts, deliveries: Array.from({ length: 9 }, (_, i) => ({ ref: `ECH-${i}`, title: "t", personId: "fer" })), clips: Array.from({ length: 5 }, (_, i) => ({ ref: `r${i}`, title: "t", file: `clips/${i}.mp4` })), helps: Array.from({ length: 7 }, () => facts.helps[0]!) };
    const { facts: f, scenes } = planScenes(many, ruleTeamTexts(many));
    expect(scenesSeconds(scenes)).toBeLessThanOrEqual(TEAM_VIDEO_RULES.maxSeconds);
    expect(f.deliveries).toHaveLength(TEAM_VIDEO_RULES.maxDeliveries);
    expect(f.clips.length).toBeLessThanOrEqual(TEAM_VIDEO_RULES.maxClips);
  });
});

describe("vídeo da semana: narração", () => {
  it("cada cena tem fala; números e telas novas por regra, só com os totais", () => {
    const { scenes } = planScenes(facts, ruleTeamTexts(facts));
    expect(scenes.every((s) => s.narration.trim().length > 0)).toBe(true);
    expect(numbersNarration(facts)).toBe("Nesta semana, foram 2 entregas, 2 ajudas entre colegas e 7 respostas dos gêmeos.");
    expect(numbersNarration({ ...facts, helps: [], twins: { answered: 0, peopleIds: [] } })).toBe("Nesta semana, foram 2 entregas.");
    expect(scenes.find((s) => s.kind === "clip")!.narration).toBe("Uma das telas novas: Tela.");
  });
  it("a voz estica a cena quando não cabe; cenas seguintes andam junto", () => {
    const { scenes } = planScenes(facts, ruleTeamTexts(facts));
    const out = stretchScenes(scenes, [8, null, 1]);
    expect(out[0]!.seconds).toBe(8 + NARRATION_PAD_S);
    expect(out[1]!.at).toBe(8.9);
    expect(out[2]!.seconds).toBe(scenes[2]!.seconds);
  });
});

describe("vídeo da semana: textos", () => {
  const good = { opening: "A semana da equipe Produto", deliveries: "2 entregas chegaram ao fim", helps: "Ajudas destravaram o trabalho", twins: "Os gêmeos responderam 7 perguntas", closing: "Bom fim de semana" };
  it("texto bom passa; os de regra também", () => {
    expect(teamTextIssues(good, facts)).toEqual([]);
    expect(teamTextIssues(ruleTeamTexts(facts), facts)).toEqual([]);
  });
  it("ranking, primeira pessoa e número inventado são recusados", () => {
    expect(teamTextIssues({ ...good, helps: "Carla foi a melhor da semana" }, facts)).toContain("helps: compara ou classifica pessoas");
    expect(teamTextIssues({ ...good, closing: "Nós fechamos a semana" }, facts)).toContain("closing: primeira pessoa");
    expect(teamTextIssues({ ...good, deliveries: "30 entregas" }, facts)).toContain("deliveries: número fora dos totais (30)");
    expect(teamTextIssues(null, facts)).toHaveLength(5);
  });
  it("ranking com acento e por quantidade também é recusado", () => {
    for (const helps of ["Carla foi a campeã da semana", "Fernando, o campeão de entregas", "As campeãs do sprint", "A melhor da semana", "Carla, o que mais entregou", "Quem mais ajudou foi Carla", "Top 3 da equipe", "Destaques: Fernando"]) {
      expect(teamTextIssues({ ...good, helps }, facts), helps).toContain("helps: compara ou classifica pessoas");
    }
  });
  it("frases que não são ranking passam (sem recusar demais)", () => {
    for (const helps of ["A tela do campeonato ficou pronta", "O checkout melhorou", "Ajudas trouxeram melhorias", "As anotações ajudaram a equipe", "Foi uma semana notável", "Tudo o que a equipe entregou", "Ajudas destravaram o que mais travava"]) {
      expect(teamTextIssues({ ...good, helps }, facts), helps).toEqual([]);
    }
  });
});

describe("vídeo da semana: liberação", () => {
  const sent = new Date("2026-11-09T21:00:00Z");
  const h = 3_600_000;
  it("só relatório liberado ao RH conta; em conferência não libera o vídeo", () => {
    expect(teamVideoDue(2, [{ state: "awaiting_owner", sentAt: null }, { state: "commented", sentAt: null }], sent)).toBe(false);
    expect(teamVideoDue(2, [{ state: "draft", sentAt: null }, { state: "sent", sentAt: sent }], sent)).toBe(false);
    expect(teamVideoDue(2, [{ state: "sent", sentAt: sent }, { state: "sent_without_notice", sentAt: sent }], sent)).toBe(true);
  });
  it("sem todos liberados, sai 24 h depois do primeiro liberado", () => {
    const r = [{ state: "sent", sentAt: sent }, { state: "awaiting_owner", sentAt: null }];
    expect(teamVideoDue(2, r, new Date(sent.getTime() + 24 * h - 1))).toBe(false);
    expect(teamVideoDue(2, r, new Date(sent.getTime() + 24 * h))).toBe(true);
    expect(teamVideoDue(2, [], new Date(sent.getTime() + 99 * h))).toBe(false);
  });
});

describe("vídeo da semana: gravação", () => {
  const ctx = { previewHosts: ["abc.vercel.app"], plannedSeconds: 40 };
  it("duração perto das cenas e só preview ou página local", () => {
    expect(teamRecordingIssues({ visited: ["https://abc.vercel.app/x", "file:///tmp/semana/semana.html", "about:blank"] }, { ...ctx, mp4DurationS: 41.5 })).toEqual([]);
    expect(teamRecordingIssues({ visited: [] }, { ...ctx, mp4DurationS: 20 })).toContain("vídeo mais curto que as cenas (20 s de 40 s)");
    expect(teamRecordingIssues({ visited: [] }, { ...ctx, mp4DurationS: 120 })).toContain("duração fora do limite (120 s)");
    expect(teamRecordingIssues({ visited: ["https://app.echo.com.br"] }, { ...ctx, mp4DurationS: 41 })).toContain("o navegador saiu do preview");
  });
});

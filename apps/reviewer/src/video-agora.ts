// Vídeo da semana na hora, para testar a gravação de verdade sem banco, sem worker e sem relatórios: monta a semana
// de uma equipe de demonstração (dados sintéticos), escreve os textos com o Claude, grava no Managed Agents
// (trecho de tela opcional e a página animada), confere fora do ambiente e salva o mp4 nesta máquina para assistir.
// Cria o agente e o ambiente se ainda não houver IDs. Custa uma sessão do Managed Agents (até US$ 2) e centavos de
// texto e roteiro.
//
// Uso: pnpm video:agora [--preview <endereço https do preview>] [--titulo "Nova tela de pagamentos"]
//                       [--arquivos app/a/page.tsx,app/b.tsx] [--host meu-preview.exemplo.com] [--manter]
//   --preview  grava também um trecho de tela nesse preview (sem ele, só a página animada)
//   --host     domínio do preview, se não for *.vercel.app (vale ao criar ou atualizar o ambiente)
//   --manter   não apaga o mp4 da Files API depois de baixar
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type AvatarTraits, finalScenes, mp4DurationSeconds, prepareTeamVideo, recordScenes, previewOrigin, type PullRequest, scenesSeconds, teamRecordingIssues, type TeamWeekFacts, VIDEO_BUDGET_USD } from "@echo/agents";
import { provisionVideo, videoTestKit } from "@echo/agents/server";
import { LogRunRecorder } from "@echo/observability";

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
if (!apiKey) {
  console.error("ANTHROPIC_API_KEY ausente no .env: o vídeo usa a chave da empresa.");
  process.exit(1);
}
const previewArg = opt("preview");
const preview = previewArg ? previewOrigin(previewArg) : null;
if (previewArg && !preview) {
  console.error("--preview precisa ser um endereço https.");
  process.exit(1);
}

const host = opt("host");
const ids = await provisionVideo(apiKey, { agentId: process.env.VIDEO_AGENT_ID?.trim() || undefined, environmentId: process.env.VIDEO_ENVIRONMENT_ID?.trim() || undefined }, host ? [host] : undefined);
if (ids.created.length) {
  console.log(`Criado: ${ids.created.join(" e ")}. Guarde no .env (e no echo-worker na Render) para não criar de novo:`);
  console.log(`VIDEO_AGENT_ID=${ids.agentId}\nVIDEO_ENVIRONMENT_ID=${ids.environmentId}\n`);
}
const kit = videoTestKit(apiKey, { ...ids, timeoutMs: Number(process.env.VIDEO_TIMEOUT_MS) || 25 * 60_000 });

// Equipe de demonstração, com trabalho sintético (Fernando, Eduardo e Yan têm o nome real).
const look = (hair: string, hairColor: string, skin: string, top: string, topColor: string, extra: Partial<AvatarTraits> = {}) => ({ hair, hairColor, skin, top, topColor, eyewear: "none", facialHair: "none", headwear: "none", ...extra }) as AvatarTraits;
const facts: TeamWeekFacts = {
  teamName: "Produto",
  weekLabel: "2 a 6/11",
  people: [
    { id: "fer", name: "Fernando", avatar: look("short", "black", "s3", "hoodie", "navy", { facialHair: "stubble" }) },
    { id: "edu", name: "Eduardo", avatar: look("curly", "darkBrown", "s2", "shirt", "teal", { eyewear: "glasses" }) },
    { id: "yan", name: "Yan", avatar: look("side", "black", "s3", "tshirt", "black") },
    { id: "mar", name: "Marina", avatar: look("long", "brown", "s2", "jacket", "purple") },
    { id: "bru", name: "Bruno", avatar: look("buzz", "black", "s5", "tshirt", "green", { facialHair: "beard" }) },
    { id: "car", name: "Carla", avatar: look("bun", "auburn", "s1", "shirt", "orange", { eyewear: "glasses" }) },
  ],
  deliveries: [
    { ref: "ECH-128", title: "Tempo limite tratado nas chamadas de pagamento", personId: "fer" },
    { ref: "ECH-131", title: "Versão 2 da API de pedidos", personId: "edu" },
    { ref: "ECH-137", title: "Bonequinho refeito pela foto na ficha", personId: "yan" },
    { ref: "ECH-140", title: "Plano de redistribuição com troca de responsável", personId: "mar" },
  ],
  helps: [
    { fromId: "car", toId: "bru", count: 2 },
    { fromId: "edu", toId: "fer", count: 1 },
    { fromId: "fer", toId: "yan", count: 1 },
  ],
  twins: { answered: 12, peopleIds: ["fer", "edu", "yan"] },
  clips: [],
};
const pr: PullRequest = {
  id: "teste",
  repository: "echo/app",
  number: 137,
  title: opt("titulo") ?? "Tela Pessoas com o bonequinho de cada gêmeo",
  authorId: "yan",
  state: "merged",
  branch: "teste",
  files: (opt("arquivos") ?? "apps/web/app/(painel)/equipe/page.tsx").split(",").map((f) => f.trim()).filter(Boolean),
  reviewerIds: [],
  taskKey: "ECH-137",
};

console.log("1/3 Textos, roteiro do trecho e cenas …");
const recorder = new LogRunRecorder();
const prep = await prepareTeamVideo(kit.model, facts, preview ? [{ pr, previewUrl: preview }] : [], recorder);
const cost = recorder.runs.reduce((s, r) => s + (r.costUsd ?? 0), 0);
console.log(`    textos ${prep.story.textsBy === "model" ? "do modelo" : "por regra"} · ${prep.clips.length} trecho(s) · US$ ${cost.toFixed(4)}`);
for (const s of prep.story.scenes) console.log(`    ${s.at.toFixed(1).padStart(5)} s  ${s.kind.padEnd(10)} ${s.title}`);
for (const r of recorder.runs.filter((x) => x.error)) console.log(`    aviso (${r.flow}): ${r.error}`);
writeFileSync(join(tmpdir(), "echo-semana.html"), prep.html);

console.log(`2/3 Gravando no Managed Agents (teto US$ ${VIDEO_BUDGET_USD.toFixed(2)}; leva alguns minutos) …`);
const started = Date.now();
const r = await kit.sandbox.record({ title: "Echo · teste do vídeo da semana", html: prep.html, clips: prep.clips, scenes: recordScenes(prep.story.scenes), budgetUsd: VIDEO_BUDGET_USD });
console.log(`    sessão ${r.sessionId} · ${r.outcome} · US$ ${r.costUsd.toFixed(4)} · ${Math.round((Date.now() - started) / 1000)} s`);
if (r.outcome !== "done" || !r.video) {
  console.error(`Sem vídeo: ${r.error ?? r.outcome}. Veja a sessão no Console da Anthropic para o que o agente fez.`);
  process.exit(1);
}

console.log("3/3 Conferindo fora do ambiente …");
const duration = mp4DurationSeconds(r.video.bytes);
const scenes = finalScenes(prep.story.scenes, r.meta);
const problems = teamRecordingIssues(r.meta, { previewHosts: prep.hosts, plannedSeconds: scenesSeconds(scenes), mp4DurationS: duration });
console.log(`    áudio: ${(r.meta as { voice?: string } | null)?.voice === "voz" ? "voz e trilha" : "só trilha (a voz falhou)"}`);
const file = join(tmpdir(), `echo-semana-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.mp4`);
writeFileSync(file, r.video.bytes);
console.log(`    duração ${duration?.toFixed(1) ?? "?"} s · ${(r.video.bytes.length / 1024).toFixed(0)} KB · trechos gravados: ${JSON.stringify((r.meta as { clips?: number[] } | null)?.clips ?? [])}`);
console.log(problems.length ? `    RECUSADO pela regra: ${problems.join("; ")}` : "    aprovado pela regra (duração e domínios)");
console.log(`\nmp4 salvo em ${file}`);
if (!args.includes("--manter")) await kit.deleteFile(r.video.fileId).catch(() => undefined);
process.exit(problems.length ? 1 : 0);

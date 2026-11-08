// Página animada do vídeo da semana da equipe: HTML único, sem rede e sem fonte externa, gravado pelo executor
// no Managed Agents. Cada cena entra no tempo planejado por regra (planScenes); os números vêm dos relatórios e os
// textos já passaram pelo validador. Os bonequinhos são os mesmos do painel e do Slack.
import { type AvatarTraits, composeEchoSprite, composeSprite, type Scene, scenesSeconds, type SpritePixels, teamTotals, type TeamWeekFacts, type TeamWeekTexts } from "@echo/domain";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Sprite em SVG com retângulos por linha (bordas nítidas na ampliação). */
function spriteSvg(sp: SpritePixels, size: number, cls = ""): string {
  const rects: string[] = [];
  for (let y = 0; y < sp.height; y++) {
    let x = 0;
    while (x < sp.width) {
      const fill = sp.pixels[y * sp.width + x];
      let w = 1;
      while (x + w < sp.width && sp.pixels[y * sp.width + x + w] === fill) w++;
      if (fill) rects.push(`<rect x="${x}" y="${y}" width="${w}" height="1" fill="${fill}"/>`);
      x += w;
    }
  }
  return `<svg class="px ${cls}" viewBox="0 0 ${sp.width} ${sp.height}" width="${Math.round((size * sp.width) / sp.height)}" height="${size}" shape-rendering="crispEdges" aria-hidden="true">${rects.join("")}</svg>`;
}

const sprite = (t: AvatarTraits, size: number, cls = "") => spriteSvg(composeSprite(t), size, cls);

export function teamVideoHtml(facts: TeamWeekFacts, texts: TeamWeekTexts, scenes: Scene[], opts: { clipHost?: string } = {}): string {
  const people = new Map(facts.people.map((p) => [p.id, p]));
  const first = (id: string) => (people.get(id)?.name ?? "Alguém").split(" ")[0]!;
  const look = (id: string) => people.get(id)?.avatar;
  const totals = teamTotals(facts);
  const total = scenesSeconds(scenes);

  const crew = facts.people
    .slice(0, 10)
    .map((p, i) => `<figure class="crew__m" style="--i:${i}">${sprite(p.avatar, 108, "walk")}<figcaption>${esc(p.name.split(" ")[0]!)}</figcaption></figure>`)
    .join("");

  const numbers = [
    { n: totals.deliveries, k: totals.deliveries === 1 ? "entrega" : "entregas", c: "on" },
    { n: totals.helps, k: totals.helps === 1 ? "ajuda entre colegas" : "ajudas entre colegas", c: "wait" },
    { n: totals.answered, k: totals.answered === 1 ? "resposta dos gêmeos" : "respostas dos gêmeos", c: "twin" },
  ]
    .filter((x) => x.n > 0)
    .map((x, i) => `<div class="num num--${x.c}" style="--i:${i}"><span class="num__v" data-count="${x.n}">0</span><span class="num__k">${esc(x.k)}</span></div>`)
    .join("");

  const deliveries = facts.deliveries
    // Sem autor (nem nome, nem bonequinho): com até 6 cards daria para contar entregas por pessoa, perto de um
    // ranking (regra 7). A entrega é da equipe; o card mostra só a referência e o título.
    .map((d, i) => `<li class="card" style="--i:${i}"><div><p class="card__ref">${esc(d.ref)}</p><p class="card__title">${esc(d.title)}</p></div></li>`)
    .join("");

  const clips = facts.clips
    .map(
      (c, i) =>
        `<section class="scene scene--clip" data-scene="clip-${i}"><p class="kicker">Tela nova · ${esc(c.ref)}</p><div class="win"><div class="win__bar"><i></i><i></i><i></i><span>${esc(opts.clipHost ?? "preview")}</span></div><video src="${esc(c.file)}" muted playsinline preload="auto"></video><div class="win__miss"><p>${esc(c.title)}</p></div></div></section>`,
    )
    .join("");

  const helps = facts.helps
    .map((h, i) => {
      const a = look(h.fromId);
      const b = look(h.toId);
      return `<li class="help" style="--i:${i}">${a ? sprite(a, 72) : ""}<span class="help__arc"><i class="spark"></i></span>${b ? sprite(b, 72) : ""}<p><b>${esc(first(h.fromId))}</b> ajudou <b>${esc(first(h.toId))}</b></p></li>`;
    })
    .join("");

  const twinCrew = facts.twins.peopleIds
    .map((id) => look(id))
    .filter((t): t is AvatarTraits => Boolean(t))
    .slice(0, 6)
    .map((t, i) => `<span class="holo" style="--i:${i}">${sprite(t, 112)}</span>`)
    .join("");

  // Posição pseudoaleatória estável (sem padrão em colunas).
  const rnd = (n: number) => {
    const v = Math.sin(n * 12.9898) * 43758.5453;
    return v - Math.floor(v);
  };
  const stars = Array.from({ length: 70 }, (_, i) => {
    const x = rnd(i + 1) * 100;
    const y = rnd(i + 101) * 62;
    return `<i style="left:${x.toFixed(1)}%;top:${y.toFixed(1)}%;--d:${(i % 7) * 0.4}s"></i>`;
  }).join("");


  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(texts.opening)}</title>
<style>
:root{--bg:#07080a;--panel:#111318;--line:#23262d;--cloud:#f2f3f5;--fog:#b7bcc6;--ash:#7c828d;--on:#98ff38;--twin:#4d8dff;--wait:#e0b354}
*{box-sizing:border-box;margin:0}
html,body{width:1280px;height:720px;overflow:hidden;background:var(--bg);color:var(--cloud);font-family:"DejaVu Sans","Inter",system-ui,sans-serif}
.stage{position:relative;width:1280px;height:720px;overflow:hidden;background:radial-gradient(1200px 600px at 70% -10%,#1a2333 0%,transparent 60%),radial-gradient(900px 500px at -10% 110%,#132016 0%,transparent 55%),var(--bg)}
.stage::before{content:"";position:absolute;inset:0;background-image:linear-gradient(var(--line) 1px,transparent 1px),linear-gradient(90deg,var(--line) 1px,transparent 1px);background-size:48px 48px;opacity:.18;mask-image:radial-gradient(circle at 50% 40%,#000 0%,transparent 75%)}
.brand{position:absolute;top:28px;left:40px;display:flex;align-items:baseline;gap:16px;z-index:5}
.brand b{font-size:26px;letter-spacing:-.02em}.brand b i{color:var(--on);font-style:normal}
.brand span{font-family:"DejaVu Sans Mono",monospace;font-size:13px;color:var(--ash);text-transform:uppercase;letter-spacing:.08em}
.scene{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;opacity:0;transform:translateY(24px) scale(.985);transition:opacity .6s ease,transform .8s cubic-bezier(.2,.8,.2,1);pointer-events:none}
.scene.on{opacity:1;transform:none}
.scene.off{opacity:0;transform:translateY(-18px) scale(1.01)}
.title{font-size:58px;line-height:1.08;letter-spacing:-.03em;text-align:center;max-width:1000px}
.title .w{display:inline-block;opacity:0;transform:translateY(28px);filter:blur(8px)}
.on .title .w{animation:word .7s cubic-bezier(.2,.8,.2,1) forwards;animation-delay:calc(var(--w)*90ms + .2s)}
@keyframes word{to{opacity:1;transform:none;filter:none}}
.kicker{font-family:"DejaVu Sans Mono",monospace;font-size:14px;letter-spacing:.14em;text-transform:uppercase;color:var(--on);margin-bottom:18px;opacity:0}
.on .kicker{animation:fade .6s ease forwards .1s}
@keyframes fade{to{opacity:1}}
.crew{display:flex;gap:26px;align-items:flex-end;margin-top:54px;padding-bottom:10px;border-bottom:2px solid var(--line)}
.crew__m{display:flex;flex-direction:column;align-items:center;gap:10px;opacity:0;transform:translateX(-80px)}
.on .crew__m{animation:enter .7s cubic-bezier(.2,.9,.3,1.2) forwards;animation-delay:calc(var(--i)*110ms + .8s)}
.crew__m figcaption{font-size:14px;color:var(--fog)}
@keyframes enter{to{opacity:1;transform:none}}
.on .walk{animation:bob .5s steps(2) infinite;animation-delay:calc(var(--i)*60ms)}
@keyframes bob{50%{transform:translateY(-4px)}}
.px{image-rendering:pixelated;filter:drop-shadow(0 6px 0 rgba(0,0,0,.35))}
.nums{display:flex;gap:56px;margin-top:40px}
.num{display:flex;flex-direction:column;align-items:center;gap:8px;min-width:250px;padding:34px 26px;border:1px solid var(--line);border-radius:22px;background:linear-gradient(180deg,#14171d,#0d0f13);opacity:0;transform:translateY(30px) scale(.94)}
.on .num{animation:pop .7s cubic-bezier(.2,.9,.3,1.25) forwards;animation-delay:calc(var(--i)*160ms + .3s)}
@keyframes pop{to{opacity:1;transform:none}}
.num__v{font-size:96px;font-weight:700;letter-spacing:-.04em;line-height:1}
.num--on .num__v{color:var(--on)}.num--twin .num__v{color:var(--twin)}.num--wait .num__v{color:var(--wait)}
.num__k{font-size:18px;color:var(--fog)}
.cards{list-style:none;padding:0;display:grid;grid-template-columns:repeat(2,520px);gap:18px;margin-top:34px}
.card{display:flex;gap:18px;align-items:center;padding:18px 22px;border:1px solid var(--line);border-radius:18px;background:var(--panel);opacity:0;transform:translateY(26px)}
.on .card{animation:pop .6s cubic-bezier(.2,.9,.3,1.15) forwards;animation-delay:calc(var(--i)*230ms + .5s)}
.card__ref{font-family:"DejaVu Sans Mono",monospace;font-size:13px;color:var(--on);letter-spacing:.06em}
.card__title{font-size:19px;margin:4px 0 6px;line-height:1.25}
.win{width:860px;border-radius:16px;overflow:hidden;border:1px solid #2c3038;box-shadow:0 40px 120px rgba(0,0,0,.6),0 0 0 1px rgba(255,255,255,.03);transform:scale(.96);transition:transform 10s linear}
.scene--clip.on .win{transform:scale(1.02)}
.win__bar{display:flex;align-items:center;gap:8px;height:38px;padding:0 16px;background:#16191f;border-bottom:1px solid #2c3038}
.win__bar i{width:12px;height:12px;border-radius:50%;background:#3a3f48}.win__bar i:first-child{background:#ff5f57}.win__bar i:nth-child(2){background:#febc2e}.win__bar i:nth-child(3){background:#28c840}
.win__bar span{margin-left:14px;font-family:"DejaVu Sans Mono",monospace;font-size:13px;color:var(--ash)}
.win__miss{display:none;aspect-ratio:16/9;align-items:center;justify-content:center;background:radial-gradient(circle at 50% 40%,#18202c,#0b0d11);font-size:30px;color:var(--fog);padding:40px;text-align:center}
.win.miss video{display:none}.win.miss .win__miss{display:flex}
.win video{display:block;width:100%;aspect-ratio:16/9;background:#000;object-fit:cover}
.helps{list-style:none;padding:0;display:flex;flex-direction:column;gap:16px;margin-top:34px}
.help{display:flex;align-items:center;gap:20px;opacity:0;transform:translateX(-40px)}
.on .help{animation:enter .6s cubic-bezier(.2,.9,.3,1.15) forwards;animation-delay:calc(var(--i)*300ms + .5s)}
.help p{font-size:22px;color:var(--fog);margin-left:12px}.help b{color:var(--cloud);font-weight:600}
.help__arc{position:relative;width:120px;height:3px;background:linear-gradient(90deg,transparent,var(--wait),transparent);border-radius:3px}
.spark{position:absolute;top:-5px;left:0;width:13px;height:13px;border-radius:50%;background:var(--wait);box-shadow:0 0 18px var(--wait)}
.on .spark{animation:travel 1.4s ease-in-out infinite;animation-delay:calc(var(--i)*300ms + .8s)}
@keyframes travel{0%{left:0;opacity:0}15%{opacity:1}85%{opacity:1}100%{left:107px;opacity:0}}
.scene--twins{background:linear-gradient(180deg,#050816 0%,#0b1430 60%,#0f1d3d 100%)}
.sky{position:absolute;inset:0}.sky i{position:absolute;display:block;width:3px;height:3px;background:#cfe0ff;border-radius:50%;opacity:.25;animation:tw 2.4s ease-in-out infinite;animation-delay:var(--d)}
@keyframes tw{50%{opacity:1}}
.moon{position:absolute;top:70px;right:140px;width:84px;height:84px;border-radius:50%;background:radial-gradient(circle at 35% 35%,#fffbe6,#e9dfb4 60%,#c9bd8a);box-shadow:0 0 80px rgba(255,240,180,.35)}
.holos{display:flex;gap:30px;margin-top:40px;position:relative;z-index:2}
.holo{position:relative;filter:drop-shadow(0 0 2px var(--twin)) drop-shadow(0 0 16px rgba(77,141,255,.7));opacity:0}
.on .holo{animation:fade .8s ease forwards,float 3s ease-in-out infinite;animation-delay:calc(var(--i)*150ms + .4s),calc(var(--i)*200ms)}
.holo::after{content:"";position:absolute;left:0;right:0;height:10px;top:0;background:linear-gradient(transparent,rgba(77,141,255,.6),transparent);mix-blend-mode:screen;animation:scan 2.2s linear infinite}
@keyframes float{50%{transform:translateY(-8px)}}
@keyframes scan{to{top:100%}}
.twins-n{font-size:96px;font-weight:700;color:var(--twin);letter-spacing:-.04em;line-height:1;position:relative;z-index:2;text-shadow:0 0 40px rgba(77,141,255,.5)}
.scene--twins .title{font-size:32px;max-width:900px;position:relative;z-index:2;margin-top:12px}
.scene--twins .holos{margin-top:28px}
.scene--closing .px{filter:drop-shadow(0 0 3px var(--twin)) drop-shadow(0 0 30px rgba(77,141,255,.6))}
.closing__echo{opacity:0;transform:scale(.6)}
.on .closing__echo{animation:pop .9s cubic-bezier(.2,.9,.3,1.3) forwards .1s}
.foot{margin-top:28px;font-family:"DejaVu Sans Mono",monospace;font-size:13px;color:var(--ash);letter-spacing:.08em;text-transform:uppercase;opacity:0}
.on .foot{animation:fade .8s ease forwards 1s}
.progress{position:absolute;left:40px;right:40px;bottom:30px;display:flex;gap:6px;z-index:5}
.progress i{height:4px;border-radius:4px;background:#1e2128;overflow:hidden}
.progress b{display:block;height:100%;width:0;background:var(--cloud);animation:fill var(--dur) linear forwards;animation-delay:var(--at);animation-play-state:paused}
.playing .progress b{animation-play-state:running}
@keyframes fill{to{width:100%}}
</style></head>
<body><div class="stage" id="stage">
<div class="brand"><b>echo<i>.</i></b><span>Semana de ${esc(facts.weekLabel)} · Equipe ${esc(facts.teamName)}</span></div>

<section class="scene" data-scene="opening"><p class="kicker">Resumo da semana</p><h1 class="title">${words(texts.opening)}</h1><div class="crew">${crew}</div></section>
<section class="scene" data-scene="numbers"><p class="kicker">A semana em números</p><div class="nums">${numbers}</div></section>
<section class="scene" data-scene="deliveries"><p class="kicker">Entregas</p><h1 class="title" style="font-size:44px">${words(texts.deliveries)}</h1><ul class="cards">${deliveries}</ul></section>
${clips}
<section class="scene" data-scene="helps"><p class="kicker">Ajudas entre colegas</p><h1 class="title" style="font-size:44px">${words(texts.helps)}</h1><ul class="helps">${helps}</ul></section>
<section class="scene scene--twins" data-scene="twins"><div class="sky">${stars}</div><div class="moon"></div><p class="kicker" style="color:var(--twin);position:relative;z-index:2">Gêmeos em ação</p><span class="twins-n" data-count="${totals.answered}">0</span><h1 class="title">${words(texts.twins)}</h1><div class="holos">${twinCrew}</div></section>
<section class="scene scene--closing" data-scene="closing"><div class="closing__echo">${spriteSvg(composeEchoSprite(), 150)}</div><h1 class="title" style="margin-top:28px">${words(texts.closing)}</h1><p class="foot">Feito pelo Echo · Powered by Claude</p></section>

<div class="progress" id="progress"></div>
</div>
<script>
// Tempos das cenas: os planejados, ou os esticados pela voz que o executor injeta antes de carregar (__TIMINGS).
const PLANNED = ${JSON.stringify(scenes.map((s) => ({ kind: s.kind, at: s.at, seconds: s.seconds, title: s.title, ...(s.clip !== undefined ? { clip: s.clip } : {}) })))};
const SCENES = Array.isArray(window.__TIMINGS) && window.__TIMINGS.length === PLANNED.length ? PLANNED.map((s, i) => ({ ...s, at: window.__TIMINGS[i].at, seconds: window.__TIMINGS[i].seconds })) : PLANNED;
const TOTAL = SCENES.length ? SCENES[SCENES.length - 1].at + SCENES[SCENES.length - 1].seconds : ${total};
window.__scenes = SCENES;
document.getElementById("progress").innerHTML = SCENES.map((s) => '<i style="flex:' + s.seconds + '"><b style="--dur:' + s.seconds + 's;--at:' + s.at + 's"></b></i>').join("");
function count(el, ms) {
  const to = Number(el.dataset.count || 0), t0 = performance.now();
  const step = (t) => { const p = Math.min(1, (t - t0) / ms); el.textContent = String(Math.round(to * (1 - Math.pow(1 - p, 3)))); if (p < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}
function show(s) {
  const key = s.kind === "clip" ? "clip-" + s.clip : s.kind;
  document.querySelectorAll(".scene.on").forEach((e) => { e.classList.remove("on"); e.classList.add("off"); });
  const el = document.querySelector('[data-scene="' + key + '"]');
  if (!el) return;
  el.classList.remove("off"); el.classList.add("on");
  el.querySelectorAll("[data-count]").forEach((c) => count(c, 1600));
  const v = el.querySelector("video");
  if (v) { v.currentTime = 0; v.play().catch(() => v.closest(".win").classList.add("miss")); }
}
function start() {
  document.getElementById("stage").classList.add("playing");
  window.__startedAt = Date.now();
  SCENES.forEach((s) => setTimeout(() => show(s), s.at * 1000));
  setTimeout(() => { window.__done = true; }, TOTAL * 1000 + 400);
}
window.__start = start;
// Trecho que não foi gravado: a moldura mostra o título da entrega no lugar.
document.querySelectorAll(".win video").forEach((v) => v.addEventListener("error", () => v.closest(".win").classList.add("miss")));
if (!location.search.includes("manual")) window.addEventListener("load", () => setTimeout(start, 300));
</script></body></html>`;
}

/** Título em palavras, para a entrada palavra por palavra. */
function words(text: string): string {
  return esc(text)
    .split(" ")
    .map((w, i) => `<span class="w" style="--w:${i}">${w}</span>`)
    .join(" ");
}

"use client";

import { useRef } from "react";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { gsap, useGSAP } from "@/lib/motion";

gsap.registerPlugin(ScrollTrigger);

/** A pergunta às 03:15 e a volta às 9h: 345 minutos da história que a página conta. */
const WAIT_MINUTES = 345;
const hhmm = (m: number) => `${Math.floor(m / 60)}h${String(Math.floor(m % 60)).padStart(2, "0")}`;
const TICKS = [
  { at: 0, label: "03:15" },
  { at: 30.4, label: "05:00" },
  { at: 65.2, label: "07:00" },
  { at: 100, label: "09:00" },
];

/**
 * A mesma pergunta em dois mundos: sem o Echo, a barra âmbar conta a espera até a pessoa voltar; com o Echo,
 * a resposta sai no começo e o resto da linha é trabalho. O estado final é o padrão: sem JS, a figura está pronta.
 */
export function WaitRace() {
  const root = useRef<HTMLElement>(null);
  useGSAP(
    () => {
      gsap.matchMedia().add("(prefers-reduced-motion: no-preference)", () => {
        const total = root.current?.querySelector<HTMLElement>(".lp-race__n");
        if (!total) return;
        const clock = { m: 0 };
        total.textContent = hhmm(0);
        gsap.set(".lp-race__bar", { scaleX: 0 });
        gsap.set(".lp-race__note", { opacity: 0, y: 6 });
        gsap.set(".lp-race__total--now", { opacity: 0 });
        gsap.timeline({ scrollTrigger: { trigger: root.current, start: "top 70%", once: true }, defaults: { ease: "none" } })
          .to(".lp-race__bar.is-answer", { scaleX: 1, duration: 0.3, ease: "expo.out" }, 0.15)
          .fromTo(".lp-race__ping", { scale: 1, opacity: 0.9 }, { scale: 3, opacity: 0, duration: 0.8, ease: "expo.out" }, 0.15)
          .to(".lp-race__note.is-answer", { opacity: 1, y: 0, duration: 0.4, ease: "expo.out" }, 0.3)
          .to(".lp-race__total--now", { opacity: 1, duration: 0.4, ease: "expo.out" }, 0.3)
          .to(".lp-race__bar.is-work", { scaleX: 1, duration: 2 }, 0.45)
          .to(".lp-race__bar.is-wait", { scaleX: 1, duration: 2.45 }, 0)
          .to(clock, { m: WAIT_MINUTES, duration: 2.45, onUpdate: () => void (total.textContent = hhmm(clock.m)) }, 0)
          .to(".lp-race__note.is-end", { opacity: 1, y: 0, duration: 0.45, ease: "expo.out", stagger: 0.08 }, 2.3);
      });
    },
    { scope: root },
  );

  return (
    <figure
      ref={root}
      className="lp-race"
      role="img"
      aria-label="Às 03:15, Eduardo precisa de uma resposta de Fernando. Sem o Echo, a pergunta fica parada 5h45, até Fernando voltar às 9h. Com o Echo, o agente responde em segundos e Eduardo segue trabalhando."
    >
      <p className="lp-race__ask" aria-hidden="true">
        Às 03:15 em Fortaleza, Eduardo precisa de uma resposta de Fernando, que só volta às 9h.
      </p>
      <div className="lp-race__rows" aria-hidden="true">
        <div className="lp-race__row">
          <span className="lp-race__k">Sem o Echo</span>
          <div className="lp-race__line">
            <div className="lp-race__track">
              <span className="lp-race__bar is-wait" />
            </div>
            <p className="lp-race__note is-end lp-race__note--right">Fernando volta e responde</p>
          </div>
          <p className="lp-race__total">
            <span className="lp-race__n">{hhmm(WAIT_MINUTES)}</span>
            <span className="lp-race__unit">parado</span>
          </p>
        </div>
        <div className="lp-race__row">
          <span className="lp-race__k">Com o Echo</span>
          <div className="lp-race__line">
            <div className="lp-race__track">
              <span className="lp-race__bar is-answer" />
              <span className="lp-race__ping" />
              <span className="lp-race__bar is-work" />
            </div>
            <div className="lp-race__notes">
              <p className="lp-race__note is-answer">Agente de Fernando responde, com a fonte</p>
              <p className="lp-race__note is-end lp-race__note--right">Eduardo seguiu trabalhando</p>
            </div>
          </div>
          <p className="lp-race__total lp-race__total--now">
            <span className="lp-race__v">segundos</span>
            <span className="lp-race__unit">até a resposta</span>
          </p>
        </div>
        <div className="lp-race__row">
          <span />
          <div className="lp-race__axis">
            {TICKS.map((t) => (
              <span key={t.label} className="lp-mono" style={{ left: `${t.at}%` }}>
                {t.label}
              </span>
            ))}
          </div>
          <span />
        </div>
      </div>
    </figure>
  );
}

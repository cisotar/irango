"use client";

import { useEffect } from "react";

const PALAVRAS = ["em minutos", "sem comissão", "no WhatsApp", "para vender"];

/**
 * Efeitos da landing (header que escurece no scroll, palavra rotativa, reveal,
 * contador, parallax dos celulares). Não renderiza nada: opera no DOM já
 * renderizado pelo servidor dentro de `.lp`. Sem JS a página continua legível
 * (`.lp:not(.js)` desliga o estado inicial oculto do reveal).
 */
export function LandingEfeitos() {
  useEffect(() => {
    const raiz = document.querySelector<HTMLElement>(".lp");
    if (!raiz) return;
    const reduzido = matchMedia("(prefers-reduced-motion:reduce)").matches;
    const limpar: Array<() => void> = [];

    const header = raiz.querySelector("header");
    const aoRolar = () => header?.classList.toggle("scrolled", window.scrollY > 30);
    aoRolar();
    window.addEventListener("scroll", aoRolar, { passive: true });
    limpar.push(() => window.removeEventListener("scroll", aoRolar));

    // Reveal: só esconde depois que o observer existe.
    raiz.classList.add("js");
    const io = new IntersectionObserver(
      (es) =>
        es.forEach((e) => {
          if (!e.isIntersecting) return;
          e.target.classList.add("in");
          io.unobserve(e.target);
        }),
      { threshold: 0.18 },
    );
    raiz.querySelectorAll(".rv").forEach((el) => io.observe(el));
    limpar.push(() => io.disconnect());

    const contador = new IntersectionObserver(
      (es) =>
        es.forEach((e) => {
          if (!e.isIntersecting) return;
          contador.unobserve(e.target);
          const el = e.target as HTMLElement;
          const alvo = Number(el.dataset.count);
          const sufixo = el.dataset.suf ?? "";
          if (reduzido || !alvo) return;
          const t0 = performance.now();
          const passo = (t: number) => {
            const p = Math.min((t - t0) / 1600, 1);
            el.textContent = Math.round(alvo * (1 - Math.pow(1 - p, 3))) + sufixo;
            if (p < 1) requestAnimationFrame(passo);
          };
          requestAnimationFrame(passo);
        }),
      { threshold: 0.6 },
    );
    raiz.querySelectorAll("[data-count]").forEach((el) => contador.observe(el));
    limpar.push(() => contador.disconnect());

    const rot = raiz.querySelector<HTMLElement>("#rot");
    if (rot && !reduzido) {
      let i = 0;
      rot.style.transition = "opacity .25s";
      const id = setInterval(() => {
        i = (i + 1) % PALAVRAS.length;
        rot.style.opacity = "0";
        setTimeout(() => {
          rot.textContent = PALAVRAS[i];
          rot.style.opacity = "1";
        }, 250);
      }, 3000);
      limpar.push(() => clearInterval(id));
    }

    const palco = raiz.querySelector("#palco");
    if (palco && matchMedia("(pointer:fine)").matches && !reduzido) {
      const aoMover = (e: MouseEvent) => {
        const x = e.clientX / innerWidth - 0.5;
        const y = e.clientY / innerHeight - 0.5;
        palco.querySelectorAll<HTMLElement>(".phone").forEach((p) => {
          const d = Number(p.dataset.depth);
          p.style.transform = `rotate(var(--r)) translate(${x * d}px,${y * d}px)`;
        });
      };
      window.addEventListener("mousemove", aoMover);
      limpar.push(() => window.removeEventListener("mousemove", aoMover));
    }

    return () => {
      limpar.forEach((f) => f());
      raiz.classList.remove("js");
    };
  }, []);

  return null;
}

"use client";

import { useRef, useState, type ReactElement } from "react";

import {
  ehTeclaDeNavegacaoHorizontal,
  proximoIndicePorTecla,
} from "@/lib/utils/navegacao-por-teclado";
import { rotuloLongoDoDia } from "@/lib/utils/descreverVigencia";
import { DIAS_DA_SEMANA } from "@/components/painel/rascunhoCardapio";

/** A régua de `design-system.md` §5: valor LITERAL, nunca a classe semântica
 *  do Tailwind (com base de fonte 120% `min-h-11` não dá 44px). */
const ALVO = "min-h-[44px] min-w-[44px]";

/**
 * [275/desenho §8-A, aprovado] Exceção registrada a design-system §5: no modo
 * COMPACTO (linha do vínculo, diálogo de lote) sete alvos de 44px + 6 gaps não
 * cabem em 360px. A ALTURA de 44px fica intacta; só o eixo X cede, com piso de
 * 40px abaixo de `sm`. "Comprimir, não estourar".
 */
const ALVO_COMPACTO = "min-h-[44px] min-w-[40px] sm:min-w-[44px]";

export type PilulasDeDiasProps = {
  /** 0=dom..6=sáb. Vazio = "sem restrição por este eixo". Controlado. */
  valor: number[];
  onChange: (dias: number[]) => void;
  /** Texto do `aria-label` do `role="group"`. O grupo nunca é anônimo. */
  rotulo: string;
  /** Uma linha de 7 em vez de 4+3 no mobile, e iniciais no lugar de "Dom". */
  compacto?: boolean;
  desabilitado?: boolean;
  /** id do texto que explica/erra o grupo (`aria-describedby`). */
  descritoPor?: string;
};

/**
 * [275] As 7 pílulas de dia da semana — UM componente para as TRÊS superfícies
 * (vigência do cardápio, agenda do vínculo, diálogo de lote).
 *
 * Três decisões que não são livres:
 *
 *  1. **controlado e puro.** Sem `useState` de valor, sem action dentro: quem
 *     salva é o consumidor. É isso que deixa a mesma instância servir rascunho
 *     local, escrita otimista por linha e payload de lote.
 *  2. **uma tabela só.** Os rótulos curtos vêm de `DIAS_DA_SEMANA` e o nome
 *     completo do `aria-label` vem de `rotuloLongoDoDia` — a inicial do modo
 *     compacto é `rotulo.charAt(0)`, derivação e não segunda tabela (mandato 2).
 *  3. **roving tabindex** (desenho §1.3): o grupo é UMA parada de Tab. Com 7
 *     pílulas × N produtos na linha do vínculo, 7N paradas viram armadilha de
 *     teclado. A seta move o foco e NÃO marca — com escrita otimista, navegar
 *     gravando seriam 7 escritas sem intenção.
 */
export function PilulasDeDias({
  valor,
  onChange,
  rotulo,
  compacto = false,
  desabilitado = false,
  descritoPor,
}: PilulasDeDiasProps): ReactElement {
  const botoes = useRef<(HTMLButtonElement | null)[]>([]);
  // Só o índice do foco é estado LOCAL: é posição de cursor, não dado.
  const [focado, setFocado] = useState(0);

  function alternar(dia: number): void {
    onChange(
      valor.includes(dia)
        ? valor.filter((d) => d !== dia)
        : [...valor, dia].sort((a, b) => a - b),
    );
  }

  function aoTeclar(evento: React.KeyboardEvent, indice: number): void {
    if (!ehTeclaDeNavegacaoHorizontal(evento.key)) return;
    evento.preventDefault();
    const destino = proximoIndicePorTecla(
      evento.key,
      indice,
      DIAS_DA_SEMANA.length,
    );
    setFocado(destino);
    botoes.current[destino]?.focus();
  }

  return (
    <div
      role="group"
      aria-label={rotulo}
      aria-describedby={descritoPor}
      className={
        compacto
          ? "grid grid-cols-7 gap-1"
          : "grid grid-cols-4 gap-2 sm:grid-cols-7"
      }
    >
      {DIAS_DA_SEMANA.map((dia, indice) => {
        const marcado = valor.includes(dia.valor);
        return (
          <button
            key={dia.valor}
            ref={(el) => {
              botoes.current[indice] = el;
            }}
            type="button"
            aria-pressed={marcado}
            aria-label={rotuloLongoDoDia(dia.valor)}
            disabled={desabilitado}
            tabIndex={indice === focado ? 0 : -1}
            onFocus={() => setFocado(indice)}
            onKeyDown={(evento) => aoTeclar(evento, indice)}
            onClick={() => alternar(dia.valor)}
            className={`${compacto ? ALVO_COMPACTO : ALVO} rounded-lg border text-sm focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-60 ${
              marcado
                ? "border-primary bg-primary font-semibold text-primary-foreground"
                : "bg-background font-medium hover:bg-muted"
            }`}
          >
            {compacto ? dia.rotulo.charAt(0) : dia.rotulo}
          </button>
        );
      })}
    </div>
  );
}

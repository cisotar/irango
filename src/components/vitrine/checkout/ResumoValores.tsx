"use client";

// Resumo financeiro do wizard (issues 076/077/078 · 237 · 238).
//
// CRÍTICO (seguranca.md §10): todos os valores aqui são PREVIEW de UX. O servidor
// (criarPedido — 071) recalcula subtotal, desconto, frete e total a partir do
// banco. O cliente NUNCA envia valor monetário. O aviso "estimado" deixa isso
// explícito para o usuário.
//
// [237] O bloco do cupom ramifica SÓ sobre `cupom.estado` (M4): este componente
// nunca compara `baseElegivel` com `subtotal` — comparar aqui seria
// reimplementar a regra monetária no browser (D5-b). A união discriminada é a
// trava: no estado `zero` o campo `desconto` nem existe, então "Desconto
// R$ 0,00" é impossível de renderizar por acidente. Toda a copy vem de
// `lib/utils/copiaCupom.ts`, módulo puro — sem jsdom é a única forma de travar
// texto por teste.
//
// [237] "Você economizou" sai de `economiaProdutos`, que vem PRONTO da
// `revisarCarrinhoAction`. Sem o número, a linha simplesmente não é renderizada
// — nunca calculada no cliente (o carrinho guarda só o preço efetivo, RN-12).

import { useId, useState } from "react";
import { ChevronRight, Info } from "lucide-react";

import { Separator } from "@/components/ui/separator";
import { formatarMoeda } from "@/lib/utils/formatarMoeda";
import { ROTULO_FRETE_A_COMBINAR_CURTO } from "@/lib/utils/rotuloFrete";
import {
  detalhamentoCupom,
  fraseCupom,
  rotuloLinhaCupom,
  valorLinhaCupom,
  ROTULO_DETALHAMENTO,
} from "@/lib/utils/copiaCupom";
import type { EstadoCupom } from "@/lib/actions/revisarCarrinho-contrato";

export type ResumoValoresProps = {
  subtotal: number;
  /**
   * [237] Estado do cupom JÁ DECIDIDO no servidor. `null` ⇒ nenhum cupom
   * aplicado: o bloco inteiro some.
   */
  cupom?: EstadoCupom | null;
  /**
   * [237] Σ (preço de tabela − preço efetivo) × qtd, pronto do servidor.
   * `null`/0 ⇒ a linha não existe.
   */
  economiaProdutos?: number | null;
  /**
   * Frete preview; em retirada é sempre 0. (180-B) `"a_combinar"` quando o
   * frete não pôde ser calculado — exibe RÓTULO, nunca R$ 0,00 (que o cliente
   * leria como frete grátis).
   */
  frete: number | "a_combinar";
  total: number;
  /** false na Etapa 1 (frete ainda não escolhido) — oculta a linha de frete. */
  mostrarFrete?: boolean;
  /**
   * [238/D11 "preço caiu"] Faixa persistente no topo do resumo. Não é toast:
   * 4 segundos somem antes de ser lidos. Nunca bloqueia nada.
   */
  avisoPrecoCaiu?: { titulo: string; corpo: string } | null;
};

export function ResumoValores({
  subtotal,
  cupom = null,
  economiaProdutos = null,
  frete,
  total,
  mostrarFrete = true,
  avisoPrecoCaiu = null,
}: ResumoValoresProps) {
  const [detalhesAbertos, setDetalhesAbertos] = useState(false);
  const idFrase = useId();
  const idDetalhes = useId();

  const rotuloCupom = cupom ? rotuloLinhaCupom(cupom) : null;
  const valorCupom = cupom ? valorLinhaCupom(cupom) : null;
  const frase = cupom ? fraseCupom(cupom) : null;
  const detalhamento = cupom ? detalhamentoCupom(cupom) : null;

  return (
    <div className="space-y-1 text-sm">
      {avisoPrecoCaiu && (
        // Verde de promoção (§2): a semântica bate — isto é uma promoção, a
        // favor do cliente. Sem ícone de alerta e sem role="alert".
        <div
          role="status"
          aria-live="polite"
          className="mb-3 rounded-lg border border-promo-borda bg-promo-fundo px-3 py-2 text-xs text-promo-texto"
        >
          <strong className="font-bold">{avisoPrecoCaiu.titulo}</strong>{" "}
          {avisoPrecoCaiu.corpo}
        </div>
      )}

      <div className="flex justify-between">
        <span className="text-texto-muted">Subtotal</span>
        <span className="text-texto">{formatarMoeda(subtotal)}</span>
      </div>

      {economiaProdutos != null && economiaProdutos > 0 && (
        <div className="flex justify-between">
          <span className="text-texto-muted">Você economizou</span>
          <span className="font-bold text-promo-texto">
            −&nbsp;{formatarMoeda(economiaProdutos)}
          </span>
        </div>
      )}

      {cupom && (
        // Só o bloco do cupom é live region — nunca o resumo inteiro: com o
        // resumo todo em aria-live, cada +/− de quantidade reanuncia quatro
        // valores e o leitor de tela vira ruído.
        <div role="status" aria-live="polite" className="space-y-1">
          <div
            className="flex justify-between gap-3"
            aria-describedby={frase ? idFrase : undefined}
          >
            <span className="text-texto-muted">{rotuloCupom}</span>
            {/* Estado C: `valorLinhaCupom` devolve null e a coluna de valor
                nem existe — não há "R$ 0,00" a renderizar. */}
            {valorCupom && (
              <span className="shrink-0 font-bold text-promo-texto">
                {valorCupom}
              </span>
            )}
          </div>

          {frase && (
            // Texto no fluxo: não é amarelo, não tem ícone, não é alerta. É uma
            // condição do cupom, dita uma vez, onde o número aparece (RN-10-e).
            <p id={idFrase} className="pl-3 text-xs text-texto-muted">
              {frase}
            </p>
          )}

          {detalhamento && (
            <div className="pl-3">
              <button
                type="button"
                onClick={() => setDetalhesAbertos((v) => !v)}
                aria-expanded={detalhesAbertos}
                aria-controls={idDetalhes}
                className="inline-flex min-h-11 items-center gap-1 text-xs font-semibold text-texto-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cor-destaque)]"
              >
                <ChevronRight
                  aria-hidden
                  className={`size-3.5 transition-transform ${
                    detalhesAbertos ? "rotate-90" : ""
                  }`}
                />
                {ROTULO_DETALHAMENTO}
              </button>
              {detalhesAbertos && (
                <dl id={idDetalhes} className="space-y-0.5 pb-1 text-xs">
                  {detalhamento.map((linha) => (
                    <div key={linha.rotulo} className="flex justify-between gap-3">
                      <dt className="text-texto-muted">{linha.rotulo}</dt>
                      <dd className="shrink-0 tabular-nums text-texto">
                        {linha.valor}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          )}
        </div>
      )}

      {mostrarFrete && (
        <div className="flex justify-between">
          <span className="text-texto-muted">Entrega</span>
          <span className="text-texto">
            {frete === "a_combinar"
              ? ROTULO_FRETE_A_COMBINAR_CURTO
              : formatarMoeda(frete)}
          </span>
        </div>
      )}

      <Separator className="my-2 bg-borda-nav" />

      <div className="flex items-baseline justify-between">
        <span className="text-base font-extrabold text-marrom-cafe">
          Total estimado
        </span>
        <span className="text-base font-black text-[var(--cor-destaque)]">
          {formatarMoeda(total)}
        </span>
      </div>

      <div
        role="note"
        className="mt-3 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800"
      >
        <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span>
          <strong>Valores estimados.</strong> O total final é calculado e
          confirmado pela loja no servidor.
        </span>
      </div>
    </div>
  );
}

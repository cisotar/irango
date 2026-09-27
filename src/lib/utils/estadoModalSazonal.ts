/**
 * [302] O estado AO VIVO de um modal sazonal no painel — os três rótulos que o
 * lojista lê na lista ("Ativo", "Rascunho", "Fora da janela").
 *
 * É PREVIEW DE UX (spec §Behaviors): recalculado no SERVIDOR a cada render, com
 * o relógio do servidor. Nenhuma decisão depende dele — quem decide se o modal
 * ABRE na vitrine é o SSR da vitrine (issue 303), e a autoridade de escrita é a
 * RLS + a Server Action (issue 301). Aqui só mora a ESCADA de precedência entre
 * os três estados.
 *
 * Molde: `estadoDoCardapio` (estadoCardapioPainel.ts) — cores de SISTEMA (nunca
 * do tema da loja, design-system §8), vermelho fica de fora de propósito
 * (rascunho/fora-da-janela não é falha).
 *
 * A janela é comparada INSTANTE × INSTANTE (RN-02): `exibicao_inicio <= agora <
 * exibicao_fim`. Os dois extremos são `timestamptz`, então o fuso da loja não
 * muda o veredito — a mesma aritmética de `dentroDoPrazo` em `vigenciaCardapio`.
 */

import type { TomBadgeStatus } from "@/components/vitrine/BadgeStatus";
import { dentroDaJanelaExibicao } from "@/lib/utils/janelaModalSazonal";

export type EstadoModalSazonal = {
  tom: TomBadgeStatus;
  /** O texto carrega a informação inteira — cor nunca é o dado (WCAG 1.4.1). */
  rotulo: string;
};

/**
 * A escada, na ordem em que os estados se excluem:
 *
 *  1. inativo — `Rascunho` (neutro): configurado, mas fora do ar. A janela nem
 *     é avaliada, porque um rascunho não abre de qualquer forma;
 *  2. ativo e dentro da janela — `Ativo` (verde): é o modal que a vitrine
 *     mostraria neste instante;
 *  3. ativo mas fora da janela — `Fora da janela` (âmbar: requer ação do
 *     lojista, mesma semântica de "pendente" em design-system §8.2): está
 *     ligado, mas hoje não aparece porque a janela de exibição não o cobre.
 */
export function estadoDoModalSazonal(
  modal: { ativo: boolean; exibicao_inicio: string; exibicao_fim: string },
  agora: Date,
): EstadoModalSazonal {
  if (!modal.ativo) {
    return { tom: "neutro", rotulo: "Rascunho" };
  }

  if (dentroDaJanelaExibicao(modal, agora)) {
    return { tom: "verde", rotulo: "Ativo" };
  }

  return { tom: "ambar", rotulo: "Fora da janela" };
}

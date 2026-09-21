/**
 * O par textual do estado "esgotado" na vitrine — fonte ÚNICA.
 *
 * Nasceu em `CardProduto` (pill visível "Esgotado" + `aria-label`
 * "<nome> esgotado"). A issue 225 leva o mesmo estado à linha textual
 * (`ItemProdutoLista`), e o par foi extraído para cá justamente para que a lista
 * não estreie uma TERCEIRA variante de rótulo: grid e lista dizem exatamente a
 * mesma coisa, ao olho e ao leitor de tela.
 *
 * Não é o rótulo de `oculto` — produto oculto não chega ao catálogo.
 */

import type { MotivoNaoCompravel } from "@/lib/utils/catalogoVitrine";
import { ROTULO_SEM_VOLTA } from "@/lib/utils/descreverVigencia";

/** Texto visível do selo. */
export const ROTULO_ESGOTADO = "Esgotado";

/** Rótulo acessível — `aria-label` do card, texto do leitor de tela na linha. */
export function rotuloAcessivelEsgotado(nome: string): string {
  return `${nome} esgotado`;
}

// ───────────────────────────────────────────────────────────────────────────
// [262] O segundo motivo: `fora_da_janela` (D4/RN-06)
// ───────────────────────────────────────────────────────────────────────────
//
// D4 é literal: "mesmo padrão visual de `esgotado`, não o de `oculto`". Então
// não nasce componente novo — o critério de aceite da 262 é um `grep` vazio
// pelo nome que este módulo evitou criar — e não nasce um terceiro jeito de
// dizer "não dá para comprar": as quatro superfícies chamam ESTAS funções e só
// o TEXTO muda.
//
// A frase de "quando volta" NÃO é inventada aqui — ela desce pronta do servidor
// em `rotulosVigencia` (`projetarCatalogoVitrine`, issues 247/254), já cortada
// em 32 caracteres e escrita no fuso da LOJA. Aqui só se escolhe qual string
// imprimir, e qual é o fallback quando a chave falta.

/**
 * O texto VISÍVEL do selo, do motivo decidido no servidor.
 *
 * Chave ausente no mapa ⇒ "Indisponível no momento" (design §4.1, item 2):
 * degradação visível e correta, nunca selo em branco. Na vitrine isso é
 * puramente defensivo (por RN-13 todo produto marcado tem volta a anunciar); na
 * revisão do carrinho é caso real de negócio (design §13.7).
 */
export function rotuloNaoCompravel(
  motivo: MotivoNaoCompravel | null,
  rotuloVigencia?: string,
): string {
  if (motivo === "fora_da_janela") return rotuloVigencia || ROTULO_SEM_VOLTA;
  return ROTULO_ESGOTADO;
}

/**
 * O rótulo ACESSÍVEL — `aria-label` do "+" no card, texto do leitor de tela na
 * linha textual. Quem usa leitor de tela ouve o motivo no mesmo lugar onde o
 * vidente vê a pílula (design §4.2).
 *
 * `esgotado` mantém a redação de 225 (`"<nome> esgotado"`); `fora_da_janela`
 * usa o travessão do design (`"<nome> — Só aos sábados e domingos"`), porque a
 * frase de vigência já é uma oração inteira e não encaixa em aposto.
 */
export function rotuloAcessivelNaoCompravel(
  nome: string,
  motivo: MotivoNaoCompravel | null,
  rotuloVigencia?: string,
): string {
  if (motivo === "fora_da_janela") {
    return `${nome} — ${rotuloNaoCompravel(motivo, rotuloVigencia)}`;
  }
  return rotuloAcessivelEsgotado(nome);
}

/**
 * O texto do CTA desabilitado do modal. Curto por ser rótulo de BOTÃO: a frase
 * de vigência inteira mora no selo central e no `aria-label`, nunca no botão
 * (design §4.2 — "CTA `Produto indisponível` desabilitado").
 */
export function rotuloCtaNaoCompravel(motivo: MotivoNaoCompravel | null): string {
  return motivo === "fora_da_janela"
    ? "Produto indisponível"
    : "Produto esgotado";
}

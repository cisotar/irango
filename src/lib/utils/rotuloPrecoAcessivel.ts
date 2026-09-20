// Função PURA de apresentação: a frase ÚNICA que o leitor de tela ouve no lugar
// do par visual "preço antigo riscado + preço promocional".
//
// Existe porque `<s>` sozinho NÃO comunica "preço antigo": a maioria dos
// leitores de tela não anuncia `line-through` por padrão, e nos que anunciam é
// configurável. Por isso o par visual inteiro é `aria-hidden` e a verdade
// acessível é esta string, num `sr-only` (design §3.1).
//
// NÃO calcula dinheiro: `preco`, `precoEfetivo` e `temDesconto` chegam prontos
// do servidor pelo contrato de catálogo (`catalogoVitrine.ts`, issue 224). Aqui
// só se formata — com `formatarMoeda`, o único formatador de moeda do projeto.

import { formatarMoeda } from "./formatarMoeda";

/** Os três campos do contrato de catálogo que descrevem o preço exibido. */
export type PrecoAcessivel = {
  preco: number;
  precoEfetivo: number;
  temDesconto: boolean;
};

/**
 * @returns com desconto: `De R$ 100,00 por R$ 80,00`; sem desconto, só o preço
 * efetivo: `R$ 80,00`. Sem desconto nada é "de/por" — não se inventa promoção.
 */
export function rotuloPrecoAcessivel(produto: PrecoAcessivel): string {
  return produto.temDesconto
    ? `De ${formatarMoeda(produto.preco)} por ${formatarMoeda(produto.precoEfetivo)}`
    : formatarMoeda(produto.precoEfetivo);
}

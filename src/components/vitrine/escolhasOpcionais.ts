import type { GrupoOpcional } from "@/lib/supabase/queries/produtos";
import type { OpcionalCarrinho } from "@/types/dominio";

/** Quantidade escolhida por opcional: opcionalId → qtd (0 = não escolhido). */
export type QtdPorOpcional = Record<string, number>;

/**
 * Opcionais escolhidos (qtd > 0) ACHATADOS a partir dos grupos — preserva nome e
 * preço (PREVIEW) para exibição/carrinho; o servidor recalcula tudo no checkout
 * (seguranca.md §10).
 *
 * O achatamento é sobre `grupos` (DADO), nunca sobre o que está visível na tela:
 * opcional de grupo RECOLHIDO na sanfona (issue 210) com qtd > 0 continua entrando
 * no subtotal preview e no payload de `onAdicionar` — recolher não limpa quantidade
 * (RN-9).
 */
export function achatarOpcionaisEscolhidos(
  grupos: GrupoOpcional[],
  qtdOpcionais: QtdPorOpcional,
): OpcionalCarrinho[] {
  return grupos
    .flatMap((g) => g.opcionais)
    .map((o) => ({
      opcionalId: o.id,
      nome: o.nome,
      preco: o.preco,
      quantidade: qtdOpcionais[o.id] ?? 0,
    }))
    .filter((o) => o.quantidade > 0);
}

/**
 * Soma das quantidades escolhidas dentro de UM grupo — alimenta o `Badge` do
 * cabeçalho da sanfona, para o cliente não perder a escolha ao recolher (RN-9).
 */
export function contarEscolhidosDoGrupo(
  grupo: GrupoOpcional,
  qtdOpcionais: QtdPorOpcional,
): number {
  return grupo.opcionais.reduce((soma, o) => soma + (qtdOpcionais[o.id] ?? 0), 0);
}

/**
 * Rótulo acessível do cabeçalho do grupo, em pt-BR, nomeando a categoria
 * (ex.: "Molhos, 2 escolhidos") — WCAG AA, design-system.md §5.
 */
export function rotuloGrupoOpcional(nome: string, escolhidos: number): string {
  if (escolhidos <= 0) return nome;
  if (escolhidos === 1) return `${nome}, 1 escolhido`;
  return `${nome}, ${escolhidos} escolhidos`;
}

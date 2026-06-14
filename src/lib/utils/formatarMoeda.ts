// Função PURA de apresentação: formata um valor numérico (em reais) para a
// string monetária brasileira (BRL), usada em toda exibição de preço (vitrine
// e painel). Apenas APRESENTAÇÃO — não é fonte de valor autoritativo nem faz
// cálculo monetário (isso é das issues 008/009/012, no servidor).
//
// Delega o formato (separador de milhar, casas, símbolo) ao Intl.NumberFormat
// nativo — sem lógica própria de separador.

const formatadorBRL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

/**
 * Formata um valor em reais para a string monetária BRL pt-BR.
 *
 * @param valor valor em reais (ex.: 12.5). Arredondado a 2 casas pelo Intl.
 * @returns ex.: `R$ 12,50`, `R$ 0,00`, `R$ 1.234,56`.
 */
export function formatarMoeda(valor: number): string {
  return formatadorBRL.format(valor);
}

// "Mês corrente" no fuso da loja (issue 347, D2 / RN-D07). Função PURA: o
// instante vem de `agora`; o calendário local sai de `diaNoFuso` (Intl), a
// fonte única de fuso do projeto — um servidor em UTC erraria na virada do mês.

import { diaNoFuso } from "./fusoLoja";

/** Mês (1..12) do instante `agora` no fuso `timezone`. */
export function mesDeReferencia(agora: Date, timezone: string): number {
  return Number(diaNoFuso(agora, timezone).split("-")[1]);
}

const NOMES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

/** Nome do mês (1..12) em pt-BR minúsculo, para o rótulo "Aniversariantes de <mês>" (D7). */
export function nomeDoMes(mes: number): string {
  return NOMES[mes - 1] ?? "";
}

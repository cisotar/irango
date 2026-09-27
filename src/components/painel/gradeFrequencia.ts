/**
 * [323/C8] A GRADE produto × dia — módulo puro (mockup §3).
 *
 * A grade mostra, por produto, as 7 pílulas de dia e salva SÓ `dias_semana`
 * (D6: a RPC da grade não toca hora nem período, para não atropelar edição de
 * outra aba). Tradução entre o estado salvo e as pílulas:
 *
 *  - salvo `null` (todo dia) ⇒ as 7 pílulas marcadas;
 *  - salvo `[]` (nunca, RN-8) ⇒ nenhuma marcada;
 *  - 7 marcadas ⇒ `null` no payload; nenhuma ⇒ `[]` (sem erro).
 *
 * "Alterada" compara o valor NORMALIZADO: `null` ≠ `[]`, `[1,2]` = `[2,1]`. A
 * linha `null` intocada mostra 7 marcadas e NÃO entra no payload — nenhum
 * pré-preenchimento converte `null` em 7 dias no estado salvo.
 */

import { normalizarDiasDaFrequencia } from "@/lib/validacoes/frequencia";

const TODOS_OS_DIAS: readonly number[] = [0, 1, 2, 3, 4, 5, 6];

/** Estado salvo ⇒ pílulas marcadas. */
export function pilulasDosDias(dias: number[] | null): number[] {
  return dias === null ? [...TODOS_OS_DIAS] : normalizarDiasDaFrequencia(dias) ?? [...TODOS_OS_DIAS];
}

/** Pílulas marcadas ⇒ valor gravável (7 ⇒ `null`; nenhuma ⇒ `[]`). */
export function diasDasPilulas(pilulas: readonly number[]): number[] | null {
  return normalizarDiasDaFrequencia([...pilulas]);
}

export function mesmosDias(a: number[] | null, b: number[] | null): boolean {
  const na = normalizarDiasDaFrequencia(a);
  const nb = normalizarDiasDaFrequencia(b);
  if (na === null || nb === null) return na === nb;
  return na.length === nb.length && na.every((d, i) => d === nb[i]);
}

export type ItemDaGrade = { produto_id: string; dias_semana: number[] | null };

/**
 * O payload de `salvarGradeDeDias`: só as linhas ALTERADAS, na ordem de
 * `atual`, cada uma com `dias_semana` SEMPRE presente (D13).
 *
 * `inicial` = estado salvo por produto; `atual` = pílulas marcadas por produto.
 */
export function montarPayloadDaGrade(
  inicial: Readonly<Record<string, number[] | null>>,
  atual: Readonly<Record<string, readonly number[]>>,
): { itens: ItemDaGrade[] } {
  const itens: ItemDaGrade[] = [];
  for (const [produto_id, pilulas] of Object.entries(atual)) {
    if (!(produto_id in inicial)) continue;
    const dias = diasDasPilulas(pilulas);
    if (mesmosDias(inicial[produto_id], dias)) continue;
    itens.push({ produto_id, dias_semana: dias });
  }
  return { itens };
}

/**
 * Contrato NEUTRO da escrita de frequência de exibição, compartilhado pelo
 * LOJISTA (`produto.ts`, client autenticado sob RLS) e pelo ADMIN
 * (`admin-produtos.ts`/`admin-categorias.ts`, service_role). Sem 'use server',
 * sem I/O — molde `produto-contrato.ts` / `cardapio-contrato.ts`.
 *
 * Spec: specs/frequencia-exibicao.md (RN-5, RN-6, RN-8).
 * Plano: plan/tecnico-frequencia-exibicao.md (C4, D6, D13).
 *
 * `p_loja_id` é SEMPRE o primeiro argumento dos builders (`buscarLojaDoDono`
 * ou o `lojaId` do `prepararContextoAdmin`) — nunca vem do payload, que o
 * `.strict()` do zod já recusa com `loja_id`. Os builders emitem SEMPRE as 5
 * chaves de `p_frequencia` e SEMPRE `dias_semana` em cada item da grade, com o
 * valor já normalizado (`[]` continua `[]`, RN-8): é o par da trava de chaves
 * das RPCs (D13). Nenhum `?? null` aqui.
 */

import type { Frequencia } from "@/lib/utils/frequencia";
import { MSG_HORA_ORDEM, MSG_HORA_PAR } from "@/lib/validacoes/cardapio";
import {
  MSG_PERIODO_ORDEM,
  type DadosAplicarFrequencia,
  type DadosFrequencia,
  type DadosGradeDeDias,
} from "@/lib/validacoes/frequencia";

/** A genérica ÚNICA de escrita de frequência (`seguranca.md` §14). */
export const MSG_SALVAR_FREQUENCIA = "Não foi possível salvar a frequência.";
/** Literal já usado em `admin-categorias.ts`: id alheio e inexistente caem aqui. */
export const MSG_CATEGORIA_NAO_ENCONTRADA = "Categoria não encontrada.";

/**
 * As únicas frases de validação promovidas LITERALMENTE à UI: dizem respeito ao
 * que o lojista acabou de digitar, não revelam nada do banco.
 */
const MENSAGENS_PROMOVIDAS: ReadonlySet<string> = new Set([
  MSG_HORA_PAR,
  MSG_HORA_ORDEM,
  MSG_PERIODO_ORDEM,
]);

export function mensagemDeFrequencia(issues: readonly { message: string }[]): string {
  return issues.find((i) => MENSAGENS_PROMOVIDAS.has(i.message))?.message ?? MSG_SALVAR_FREQUENCIA;
}

/** As 5 chaves, nada mais (o parse já normalizou `dias_semana`). */
export function patchFrequenciaCategoria(f: DadosFrequencia): Frequencia {
  return {
    dias_semana: f.dias_semana,
    hora_inicio: f.hora_inicio,
    hora_fim: f.hora_fim,
    periodo_inicio: f.periodo_inicio,
    periodo_fim: f.periodo_fim,
  };
}

export function argsAplicarFrequencia(
  lojaId: string,
  d: DadosAplicarFrequencia,
): { p_loja_id: string; p_ids: string[]; p_frequencia: Frequencia } {
  return {
    p_loja_id: lojaId,
    p_ids: [...d.produto_ids],
    p_frequencia: patchFrequenciaCategoria(d.frequencia),
  };
}

export function argsGradeDeDias(
  lojaId: string,
  d: DadosGradeDeDias,
): { p_loja_id: string; p_itens: { produto_id: string; dias_semana: number[] | null }[] } {
  return {
    p_loja_id: lojaId,
    p_itens: d.itens.map((i) => ({ produto_id: i.produto_id, dias_semana: i.dias_semana })),
  };
}

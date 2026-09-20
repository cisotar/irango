/**
 * Contrato NEUTRO do produto — fonte ÚNICA das duas regras monetárias de borda
 * que os DOIS mundos de escrita precisam aplicar igual (issue 241):
 *
 *   1. `erroDeParseProduto` — qual mensagem de validação vai para a UI;
 *   2. `comPrazosNoFuso`    — RN-03, hora local → instante no fuso da loja.
 *
 * Existe porque o hub admin escreve com `service_role`, que tem BYPASSRLS:
 * nenhuma regra que more só na RLS protege aquele caminho. O que protege é a
 * PARIDADE com o caminho do lojista — e paridade por cópia vira drift. Uma
 * cópia, dois callers:
 *   - lojista: `src/lib/actions/produto.ts`
 *   - admin:   `src/app/admin/assinantes/actions/admin-produtos.ts`
 *
 * Módulo NEUTRO de propósito (sem `'use server'`): arquivo `'use server'` só
 * pode exportar função async, então não poderia exportar estes helpers síncronos
 * nem o tipo `DadosProduto`. Mesmo padrão de `patches-loja.ts` e `admin-loja.ts`.
 */

import {
  schemaProduto,
  ehMensagemDescontoMaiorQuePreco,
} from "@/lib/validacoes/produto";
import { instanteNoFuso } from "@/lib/utils/fusoLoja";

/** Forma já validada/normalizada do produto — o que pode chegar ao banco. */
export type DadosProduto = ReturnType<typeof schemaProduto.parse>;

/**
 * Erro de parse → mensagem para quem salvou (lojista OU admin em nome dele).
 * Regra de §14: só UMA mensagem de validação é promovida literal (a de D10, que
 * nomeia os dois números e as duas saídas — sem ela não dá para agir). Todo o
 * resto continua genérico, para não virar oráculo do schema.
 */
export function erroDeParseProduto(
  issues: readonly { message: string }[],
): string {
  const d10 = issues.find((i) => ehMensagemDescontoMaiorQuePreco(i.message));
  return d10?.message ?? "Produto inválido.";
}

/**
 * RN-03 — primeiro dos dois lugares de borda do fuso: a ESCRITA. O que foi
 * digitado é HORA LOCAL; o que vai para as colunas `timestamptz` é o instante
 * correspondente NO FUSO DA LOJA (`lojas.timezone` da loja dona da linha —
 * a do dono no painel, a LOJA-ALVO no hub admin; NUNCA do payload).
 * `null`/ausente continua `null`/ausente — nenhuma data inventada.
 */
export function comPrazosNoFuso(
  dados: DadosProduto,
  timezone: string,
): DadosProduto {
  return {
    ...dados,
    ...(typeof dados.desconto_inicio === "string"
      ? { desconto_inicio: instanteNoFuso(dados.desconto_inicio, timezone) }
      : {}),
    ...(typeof dados.desconto_fim === "string"
      ? { desconto_fim: instanteNoFuso(dados.desconto_fim, timezone) }
      : {}),
  };
}

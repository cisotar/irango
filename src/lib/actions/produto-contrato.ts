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
/**
 * [261] RN-14 — a recusa de marcar como exclusivo um produto que não está em
 * nenhum cardápio, escrita para quem vai agir. A frase é a literal do design
 * §13.5: ela nomeia o problema E a saída, e é a MESMA nos dois lugares onde
 * `visibilidade` é escrita (o `FormProduto` e a barra de ação em lote).
 *
 * Não é erro interno e por isso não vira mensagem genérica (`seguranca.md`
 * §14): é uma regra de negócio que o lojista precisa ler para resolver — a
 * mesma classe da mensagem de D10.
 */
export const MSG_EXCLUSIVO_SEM_CARDAPIO =
  "Este produto não está em nenhum cardápio. Escolha um cardápio antes, ou deixe-o no menu.";

/**
 * O fragmento LITERAL que o constraint trigger de 20260920131000 levanta no
 * COMMIT, com errcode 23000. Ele é o BACKSTOP que vale inclusive sob
 * `service_role` (BYPASSRLS) — por isso o reconhecedor mora aqui, no módulo
 * neutro que o caminho do lojista e o do admin compartilham, e não numa cópia
 * por action.
 *
 * Igual ao de `lib/actions/cardapio.ts`, que trata a outra ponta do mesmo
 * trigger (apagar o último vínculo de um exclusivo).
 */
const FRAGMENTO_TRIGGER_EXCLUSIVO = "produto exclusivo sem cardapio";

/** Erro do banco que é, na verdade, a recusa legível de RN-14. */
export function ehErroDeExclusivoSemCardapio(erro: unknown): boolean {
  if (erro == null || typeof erro !== "object") return false;
  const e = erro as { message?: unknown };
  return (
    typeof e.message === "string" &&
    e.message.includes(FRAGMENTO_TRIGGER_EXCLUSIVO)
  );
}

/**
 * Erro de ESCRITA de produto → mensagem para quem salvou. A recusa de RN-14
 * vira a frase acionável; todo o resto (23514 dos CHECKs de desconto, falha de
 * rede, qualquer outro código) continua genérico, com o texto cru só no log.
 */
export function erroDeEscritaDeProduto(
  erro: unknown,
  generica: string,
): string {
  return ehErroDeExclusivoSemCardapio(erro)
    ? MSG_EXCLUSIVO_SEM_CARDAPIO
    : generica;
}

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

// Queries reusáveis do MODAL DE DIVULGAÇÃO SAZONAL (issue 301). Padrão de
// `cardapios.ts`/`lojas.ts`: o caller injeta o `Client` (1º arg) — escolhe a
// role, a testabilidade fica no caller. Não criam client nem leem `process.env`.
// Propagam o `error` do PostgREST (seguranca.md §14); `null`/`[]` significam
// "sem linha" — NUNCA mascaram erro.
//
// CONTRATO DE SEGURANÇA (seguranca.md §2, spec §Modelos de Dados):
//   - `modais_sazonais_leitura_publica` (anon): só o modal ATIVO de loja ativa
//     (rascunho não vaza — RN-03). A JANELA de exibição NÃO é filtrada em SQL
//     (RN-02): quem avalia `exibicao_inicio <= agora < exibicao_fim` é a função
//     pura do SSR, no fuso da loja.
//   - `modais_sazonais_leitura_propria` (dono): lê os próprios, inclusive
//     rascunhos/inativos (painel).
//   - `.eq("loja_id", lojaId)` EXPLÍCITO além da RLS: o mesmo cinto e suspensório
//     de `cardapios.ts`, o que torna a leitura segura sob `service_role`.
//
// As tabelas `modais_sazonais` / `modal_sazonal_categorias` /
// `modal_sazonal_cardapios` (migration 300) JÁ estão aplicadas no cloud, mas
// `database.types.ts` ainda não foi regenerado e não as conhece. Até a
// regeneração, o acesso é por um client sem o genérico de `Database` — as linhas
// voltam com o SHAPE MANUAL declarado aqui, fonte única deste módulo.
//
// `mensagem` volta CRUA (`unknown`): quem exibe obtém o valor por
// `lerMensagemModal` (parse na leitura, fail-closed — RN-M04). A RLS deixa o
// dono gravar direto no PostgREST, então o que vem do banco é tão hostil quanto
// um payload.
import type { SupabaseClient } from "@supabase/supabase-js";
import { TETO_MODAIS_POR_LOJA } from "@/lib/validacoes/modalSazonal";

/** Client sem o genérico de `Database` — os tipos gerados ainda não têm as tabelas. */
type ClientAny = SupabaseClient;

/** A linha `modais_sazonais` que o painel e a vitrine consomem. */
export type ModalSazonal = {
  id: string;
  loja_id: string;
  titulo: string;
  /** JSONB cru do banco. Exibir SÓ via `lerMensagemModal` (RN-M04). */
  mensagem: unknown;
  ativo: boolean;
  exibicao_inicio: string;
  exibicao_fim: string;
  mostrar_promocoes_junto: boolean;
  criado_em: string;
  atualizado_em: string;
};

/** Um modal do painel + os ids de categoria/cardápio que ele divulga. */
export type ModalSazonalComSelecao = ModalSazonal & {
  categorias: string[];
  cardapios: string[];
};

const COLUNAS_MODAL =
  "id, loja_id, titulo, mensagem, ativo, exibicao_inicio, exibicao_fim, mostrar_promocoes_junto, criado_em, atualizado_em";

const SELECT_COM_SELECAO = `${COLUNAS_MODAL}, modal_sazonal_categorias(categoria_id), modal_sazonal_cardapios(cardapio_id)`;

/** Row crua do PostgREST: as junções vêm embutidas como arrays. */
type LinhaModal = ModalSazonal & {
  modal_sazonal_categorias: { categoria_id: string }[] | null;
  modal_sazonal_cardapios: { cardapio_id: string }[] | null;
};

/** Normaliza a row crua (com junções embutidas) para o shape de consumo. */
function hidratar(linha: LinhaModal): ModalSazonalComSelecao {
  return {
    id: linha.id,
    loja_id: linha.loja_id,
    titulo: linha.titulo,
    mensagem: linha.mensagem ?? null,
    ativo: linha.ativo,
    exibicao_inicio: linha.exibicao_inicio,
    exibicao_fim: linha.exibicao_fim,
    mostrar_promocoes_junto: linha.mostrar_promocoes_junto,
    criado_em: linha.criado_em,
    atualizado_em: linha.atualizado_em,
    categorias: (linha.modal_sazonal_categorias ?? []).map((c) => c.categoria_id),
    cardapios: (linha.modal_sazonal_cardapios ?? []).map((c) => c.cardapio_id),
  };
}

/**
 * Os modais do DONO (painel), inclusive rascunhos/inativos, com as duas listas
 * de seleção embutidas num único round trip. `.eq("loja_id", lojaId)` explícito
 * além da RLS `modais_sazonais_leitura_propria`. Ordena do mais recente ao mais
 * antigo, com `id` como desempate determinístico, até `TETO_MODAIS_POR_LOJA`
 * linhas (CWE-770). Propaga `error` (§14).
 */
export async function listarModaisSazonaisDoDono(
  client: ClientAny,
  lojaId: string,
): Promise<ModalSazonalComSelecao[]> {
  const { data, error } = await client
    .from("modais_sazonais")
    .select(SELECT_COM_SELECAO)
    .eq("loja_id", lojaId)
    .order("criado_em", { ascending: false })
    .order("id", { ascending: true })
    // O trigger do banco já barra o 51º modal; o `.limit` é o cinto do painel.
    .limit(TETO_MODAIS_POR_LOJA);
  if (error) throw error;
  return ((data ?? []) as unknown as LinhaModal[]).map(hidratar);
}

/**
 * O modal ATIVO público de uma loja para a VITRINE, com suas categorias e
 * cardápios vinculados. Filtra `ativo = true` EXPLICITAMENTE (cinto e
 * suspensório com a RLS `modais_sazonais_leitura_publica` — RN-03) e escopa por
 * `loja_id`. A JANELA de exibição NÃO é avaliada aqui (RN-02): a comparação
 * `exibicao_inicio <= agora < exibicao_fim` é do SSR, no fuso da loja.
 *
 * Loja sem modal ativo → `null`. Propaga `error` (§14) — engolir e devolver
 * `null` esconderia uma falha de leitura como "nenhum modal".
 */
export async function buscarModalSazonalAtivo(
  client: ClientAny,
  lojaId: string,
): Promise<ModalSazonalComSelecao | null> {
  const { data, error } = await client
    .from("modais_sazonais")
    .select(SELECT_COM_SELECAO)
    .eq("loja_id", lojaId)
    .eq("ativo", true)
    .maybeSingle();
  if (error) throw error;
  if (data == null) return null;
  return hidratar(data as unknown as LinhaModal);
}

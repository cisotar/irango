import { z } from "zod";

import { removerInvisiveisEControles } from "@/lib/utils/normalizarObservacao";
import { schemaMensagemModal } from "@/lib/validacoes/mensagemModal";

/**
 * Validações isomórficas do MODAL DE DIVULGAÇÃO SAZONAL (spec
 * modal-divulgacao-sazonal, issue 301). Um zod, dois consumidores: o
 * `FormModalSazonal` (react-hook-form, UX) e as Server Actions de
 * `src/lib/actions/modalSazonal.ts` (servidor, autoridade). Nada de schema
 * paralelo (`design-system.md` §6).
 *
 * Forma herdada de `schemaPerfil`/`schemaLoteDeProdutos`:
 *  - `.strict()` no objeto: uma chave hostil pendurada no payload (ex.: um
 *    `loja_id` de outra loja, ou `id` para reescrever a posse) NÃO é ignorada,
 *    é RECUSADA antes de qualquer I/O — `loja_id` é SEMPRE derivado de
 *    `buscarLojaDoDono` na Server Action, nunca do payload (RN-11);
 *  - `z.guid()` em todo id: lixo não vira ida ao banco;
 *  - `.max(TETO_SELECAO)` nas duas listas: teto de cardinalidade (CWE-770) —
 *    um payload hostil não gera milhares de INSERTs de junção;
 *  - `exibicao_fim > exibicao_inicio` (RN-02): a mesma janela ordenada que o
 *    CHECK `modais_sazonais_janela_ordem` recusa no banco, uma camada antes;
 *  - seleção e mensagem são OPCIONAIS (spec modal-sazonal-mensagem-formatada,
 *    RN-M02): um modal só com título e janela é válido;
 *  - `mensagem` é OBRIGATÓRIA como chave (`null` = sem mensagem): chave
 *    condicional impediria APAGAR a mensagem numa edição;
 *  - `titulo` endurecido (RN-M09): quebra/tab viram espaço, DEPOIS saem
 *    controles/invisíveis/bidi, DEPOIS `trim` e o tamanho. É a mesma ordem que o
 *    CHECK `modais_sazonais_titulo_sem_invisiveis` exige (ele inclui U+0009).
 *
 * As datas descem como ISO com offset (o value de um `datetime` com fuso),
 * `.datetime({ offset: true })` — o mesmo formato de `expira_em` em `cupom.ts`.
 * A comparação `fim > inicio` é lexicográfica-segura porque ambas são ISO
 * completas; a autoridade final da janela é o CHECK do banco.
 */

/** Teto de cardinalidade das listas de seleção (CWE-770). */
export const TETO_SELECAO = 50;

/**
 * Teto de modais sazonais por loja (CWE-770, RN-M08). Espelho do trigger
 * `modais_sazonais_teto_por_loja` (o banco é a autoridade, cobre INSERT direto e
 * a RPC) e limite da listagem do painel (`listarModaisSazonaisDoDono`).
 */
export const TETO_MODAIS_POR_LOJA = 50;

/**
 * Quebra de linha e tab viram ESPAÇO antes de `removerInvisiveisEControles`
 * (que preserva `\t`/`\n` e apagaria U+2028/2029 em vez de espaçar).
 */
const RE_QUEBRA_OU_TAB = /[\t\n\v\f\r\u0085\u2028\u2029]/g;

/** Título do modal (RN-01 + RN-M09). Sem colapso de espaço: só troca, remove e apara. */
const titulo = z
  .string()
  .transform((t) => removerInvisiveisEControles(t.replace(RE_QUEBRA_OU_TAB, " ")).trim())
  .pipe(z.string().min(1, "Dê um título ao modal").max(120));

/** ISO com offset (`"2026-06-01T00:00:00-03:00"`), mesmo molde de `expira_em`. */
const instante = z.string().datetime({ offset: true });

/** Lista de ids de seleção: uuid, teto de cardinalidade, sem duplicata. */
const listaDeIds = z
  .array(z.guid())
  .max(TETO_SELECAO)
  .refine((ids) => new Set(ids).size === ids.length, {
    message: "Ids repetidos na seleção",
  });

export const schemaModalSazonal = z
  .object({
    titulo,
    exibicao_inicio: instante,
    exibicao_fim: instante,
    /** Mensagem formatada (RN-M03). Chave sempre presente; `null` = sem mensagem. */
    mensagem: schemaMensagemModal.nullable(),
    /** Categorias inteiras a divulgar. Opcional (RN-M02). */
    categorias: listaDeIds,
    /** Cardápios sazonais a divulgar. Opcional (RN-M02). */
    cardapios: listaDeIds,
    /**
     * RN-09: com este modal ativo, o `ModalPromocoes` também abre? Preferência
     * de UX do lojista, não valor nem permissão. Opcional e SEM `.default` —
     * o DEFAULT vive na coluna (migration 300); um default aqui sobrescreveria
     * a escolha do lojista em todo save que não mandasse o campo.
     */
    mostrar_promocoes_junto: z.boolean().optional(),
  })
  .strict()
  // RN-02 (espelho do CHECK `modais_sazonais_janela_ordem`): fim depois do início.
  .refine((v) => v.exibicao_fim > v.exibicao_inicio, {
    message: "A data de fim precisa ser depois da de início.",
    path: ["exibicao_fim"],
  });

export type DadosModalSazonal = z.infer<typeof schemaModalSazonal>;

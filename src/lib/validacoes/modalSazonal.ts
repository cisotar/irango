import { z } from "zod";

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
 *  - `categorias.length + cardapios.length >= 1` (RN-06): um modal sem nenhuma
 *    seleção não tem o que mostrar — recusado na escrita, não no banco (a
 *    seleção vive em tabelas de junção, não em colunas da linha).
 *
 * As datas descem como ISO com offset (o value de um `datetime` com fuso),
 * `.datetime({ offset: true })` — o mesmo formato de `expira_em` em `cupom.ts`.
 * A comparação `fim > inicio` é lexicográfica-segura porque ambas são ISO
 * completas; a autoridade final da janela é o CHECK do banco.
 */

/** Teto de cardinalidade das listas de seleção (CWE-770). */
export const TETO_SELECAO = 50;

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
    titulo: z.string().trim().min(1, "Dê um título ao modal").max(120),
    exibicao_inicio: instante,
    exibicao_fim: instante,
    /** Categorias inteiras a divulgar (RN-06). Pode ser vazia se houver cardápios. */
    categorias: listaDeIds,
    /** Cardápios sazonais a divulgar (RN-06). Pode ser vazia se houver categorias. */
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
  })
  // RN-06: ao menos uma seleção. A atomicidade da gravação das junções é da
  // transação da Server Action; aqui é a barreira de FORMA, antes de qualquer I/O.
  .refine((v) => v.categorias.length + v.cardapios.length >= 1, {
    message: "Escolha pelo menos uma categoria ou um cardápio para divulgar.",
    path: ["categorias"],
  });

export type DadosModalSazonal = z.infer<typeof schemaModalSazonal>;

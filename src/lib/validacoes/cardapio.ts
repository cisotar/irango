import { z } from "zod";

/**
 * Schemas do CARDÁPIO SAZONAL (Spec B) — um zod, vários consumidores.
 *
 * Este módulo é o único lugar onde a FORMA do que o cliente manda sobre
 * cardápio é decidida: as Server Actions de lote (issue 251) e o formulário de
 * cardápio (issue 255) leem daqui, nunca de um schema paralelo.
 *
 * Forma herdada de `schemaReordenacaoCategorias` (src/lib/validacoes/produto.ts:166):
 *  - `.strict()` no objeto: propriedade hostil pendurada no payload (ex.: um
 *    `loja_id` de outra loja) não sobrevive ao parse e jamais chega a uma
 *    coluna — `loja_id` é SEMPRE derivado de `auth.uid()` na Server Action;
 *  - `z.guid()` em todo id: lixo não vira ida ao banco;
 *  - `.max(200)` na lista: teto de cardinalidade (CWE-770);
 *  - sem duplicata: a lista é um CONJUNTO de produtos, não uma sequência;
 *  - o parse devolve um array/objeto NOVO, então nada do cliente é reusado por
 *    referência.
 *
 * `.min(1)`: aplicar cardápio a zero produto é chamada sem efeito — recusada
 * antes de qualquer I/O, não no banco.
 */
const listaDeProdutos = z
  .array(z.guid())
  .min(1)
  .max(200)
  .refine((ids) => new Set(ids).size === ids.length, {
    message: "Ids repetidos na seleção",
  });

/** Aplicar/tirar por SELEÇÃO EXPLÍCITA de produtos (RN-09). */
export const schemaLoteDeProdutos = z
  .object({
    cardapio_id: z.guid(),
    produto_ids: listaDeProdutos,
  })
  .strict();

/** Aplicar por CATEGORIA INTEIRA — expandida dentro da RPC, nunca em JS (RN-10). */
export const schemaLoteDeCategoria = z
  .object({
    cardapio_id: z.guid(),
    categoria_id: z.guid(),
  })
  .strict();

/**
 * Prévia do servidor para o diálogo de confirmação (RN-09-a): a MESMA forma da
 * gravação, sem `cardapio_id` — prever não escreve, então não precisa saber em
 * qual cardápio o lote vai cair.
 */
export const schemaPreviaDeLote = z.union([
  z.object({ produto_ids: listaDeProdutos }).strict(),
  z.object({ categoria_id: z.guid() }).strict(),
]);

export type LoteDeProdutos = z.infer<typeof schemaLoteDeProdutos>;
export type LoteDeCategoria = z.infer<typeof schemaLoteDeCategoria>;
export type PreviaDeLote = z.infer<typeof schemaPreviaDeLote>;

import { z } from "zod";
import { schemaStorageUrl } from "./storage";

// Validação isomórfica (form + Server Action). Espelha as constraints do banco
// (references/schema.md). Contrato documentado em produto.test.ts.
//
// RN-11 / seguranca.md §6: `preco` é tratado como NÚMERO. A coerção string->number
// é responsabilidade da borda (form), não do schema autoritativo do servidor.
// numeric(10,2): negativo, NaN, Infinity e >2 casas decimais são rejeitados.

const preco = z
  .number()
  .finite()
  .min(0)
  .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-9, {
    message: "Preço deve ter no máximo 2 casas decimais",
  });

export const schemaProduto = z.object({
  nome: z.string().trim().min(1).max(200),
  descricao: z.string().optional(),
  preco,
  // z.guid(): qualquer UUID com formato válido (sem exigir versão/variante RFC),
  // espelhando o tipo `uuid` do Postgres, que não impõe versão.
  categoria_id: z.guid().nullable().optional(),
  disponivel: z.boolean(),
  // Visibilidade na vitrine (issue 085 / migration 083). Obrigatório e boolean,
  // espelhando `disponivel`: o form sempre envia o valor explícito; o DEFAULT
  // false vive no banco (RN-7). Separado de `disponivel` (RN-6-b).
  oculto: z.boolean(),
  ordem: z.number().int().min(0),
  // foto_url (issue 072): camada autoritativa anti-injeção de URL — renderizada
  // como <Image src> na vitrine pública. `preprocess` normaliza "" (form sem
  // foto) → null ANTES do parse (`.url()` rejeitaria ""); `.nullish()` aceita
  // ausência/null. URL externa, `javascript:` e bucket alheio são barrados pelo
  // refine de schemaStorageUrl. Tipo: `foto_url?: string | null | undefined`.
  foto_url: z.preprocess(
    (v) => (v === "" ? null : v),
    schemaStorageUrl.nullish(),
  ),
});

export const schemaCategoria = z.object({
  nome: z.string().trim().min(1),
  ordem: z.number().int().min(0),
});

/**
 * Reordenação de categorias (issue 175). O cliente manda APENAS a sequência de
 * ids — nunca valores de `ordem`, que são derivados do índice no servidor, e
 * nunca `nome`/`loja_id`. Por isso NÃO reusa `schemaCategoria`, que exige
 * justamente `nome` e `ordem`.
 *
 * `.min(2)`: lista de 1 não tem ordem (o botão nem renderiza).
 * `.max(200)`: teto de cardinalidade (CWE-770, mesmo motivo do `.max()` de
 * `pedido.ts`) — sem ele um array de 100k ids vira amplificação de payload.
 * O refine de unicidade é defesa em profundidade: a RPC também rejeita
 * duplicata pelo `row_count`, mas duplicata nem deve chegar ao banco.
 */
export const schemaReordenacaoCategorias = z
  .array(z.guid())
  .min(2)
  .max(200)
  .refine((ids) => new Set(ids).size === ids.length, {
    message: "Ids repetidos na reordenação",
  });

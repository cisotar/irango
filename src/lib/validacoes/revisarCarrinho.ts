// Schema do payload de REVISÃO DE CARRINHO (issue 228) — a fronteira de entrada
// do preview da vitrine.
//
// CRÍTICO (seguranca.md §10): o preview deixou de receber dinheiro do cliente.
// Aqui só existem ids e quantidades; `preco`, `subtotal`, `baseElegivel`,
// `desconto` e `total` NÃO são campos declarados e, com `.strict()` na raiz, no
// item e no opcional, qualquer um deles derruba o payload ANTES de qualquer I/O.
// `temDesconto` também não entra: quem está em promoção é o banco que diz.
//
// Espelha `schemaPayloadPedido` de propósito (mesmo teto de cardinalidade
// MAX_ITENS_PEDIDO — CWE-770 —, mesmo 1..99 por linha, mesmo `.max(50)` de
// opcionais distintos): preview e autoritativo recusam o MESMO payload (D5-b).

import { z } from "zod";

import { MAX_ITENS_PEDIDO } from "@/lib/constants/pedido";
import { cupomSchema } from "@/lib/validacoes/cupom";

const schemaOpcionalRevisao = z
  .object({
    opcional_id: z.guid(),
    quantidade: z.number().int().min(1).max(99),
  })
  .strict();

const schemaItemRevisao = z
  .object({
    // z.guid() (não z.uuid()) pelo mesmo motivo de `validacoes/pedido.ts`:
    // valida o FORMATO uuid sem exigir os nibbles de versão/variante RFC-4122.
    produto_id: z.guid(),
    quantidade: z.number().int().min(1).max(99),
    opcionais: z.array(schemaOpcionalRevisao).max(50).optional(),
  })
  .strict();

export const schemaRevisarCarrinho = z
  .object({
    loja_id: z.guid(),
    // Mesma normalização do cadastro (trim + uppercase + [A-Z0-9]): "promo10"
    // digitado no checkout casa o "PROMO10" gravado.
    codigo: cupomSchema.shape.codigo.optional(),
    itens: z.array(schemaItemRevisao).min(1).max(MAX_ITENS_PEDIDO),
  })
  .strict();

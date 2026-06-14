// Schema do payload de criação de pedido — a FRONTEIRA de entrada do cliente.
//
// CRÍTICO (seguranca.md §10): o cliente NÃO define quanto paga. Este schema
// declara APENAS os campos que o cliente PODE enviar (produto_id + quantidade,
// endereço, forma de pagamento, identificação). Os valores monetários
// (preco/subtotal/desconto/taxa_entrega/total) NÃO existem aqui e, com
// .strict() na raiz E nos itens, qualquer campo desconhecido vindo do cliente
// é REJEITADO. O servidor recalcula todo valor a partir do banco.

import { z } from "zod";

const schemaItemPedido = z
  .object({
    // z.guid() valida o FORMATO uuid sem exigir os nibbles de versão/variante
    // RFC-4122 (z.uuid() rejeitaria ids válidos do Postgres em casos de borda e
    // os ids de teste). gen_random_uuid() continua produzindo v4 válido.
    produto_id: z.guid(),
    quantidade: z.number().int().min(1).max(99),
    // opcionais: [083] cliente envia apenas opcional_id + quantidade — NUNCA
    // preco/nome. .strict() no objeto bloqueia injeção de valores monetários (RN-O2).
    opcionais: z
      .array(
        z
          .object({
            opcional_id: z.guid(),
            // teto 99 igual ao item (achado auditoria 085): sem limite, qtd
            // absurda estoura numeric(10,2) e polui pedido com total irreal.
            quantidade: z.number().int().min(1).max(99),
          })
          .strict(),
      )
      .max(50) // teto de opcionais distintos por item (anti payload gigante)
      .optional(),
  })
  .strict();

const schemaEnderecoEntrega = z
  .object({
    cep: z.string().regex(/^\d{5}-?\d{3}$/),
    rua: z.string().min(1),
    numero: z.string().min(1),
    bairro: z.string().min(1),
    cidade: z.string().min(1).optional(),
    // uf: adicionado conforme spec_checkout_pagamento.md Delta 1 (issue 069).
    uf: z.string().length(2).optional(),
    complemento: z.string().optional(),
  })
  .strict();

export const schemaPayloadPedido = z
  .object({
    loja_id: z.guid(),
    // tipo_entrega: 'retirada' | 'entrega' — instrução operacional, não financeira (RN-C2).
    tipo_entrega: z.enum(["retirada", "entrega"]),
    itens: z.array(schemaItemPedido).min(1),
    // endereco_entrega: opcional na raiz — o refine abaixo impõe a obrigatoriedade
    // condicional: obrigatório quando tipo_entrega='entrega', ignorado em 'retirada'.
    endereco_entrega: schemaEnderecoEntrega.optional(),
    forma_pagamento: z.enum(["pix", "dinheiro", "link", "cartao"]),
    // Normaliza p/ maiúsculas igual ao cupomSchema (cupons são gravados upper).
    // Sem isso, "promo10" no checkout não casaria o cupom "PROMO10" do banco e o
    // desconto do preview seria silenciosamente perdido no pedido (paridade preview↔real).
    codigo_cupom: z
      .string()
      .trim()
      .toUpperCase()
      .pipe(z.string().regex(/^[A-Z0-9]{3,20}$/))
      .optional(),
    // troco_para: informativo ao lojista (RN-C3) — positivo se presente.
    // NÃO entra em nenhum cálculo; servidor persiste mas ignora no total.
    troco_para: z.number().positive().optional(),
    nome_cliente: z.string().trim().min(1).max(120),
    // Limites de tamanho: anti-abuso de storage (colunas text sem limite no banco).
    telefone_cliente: z
      .string()
      .trim()
      .regex(/^\+?[\d\s()-]{8,20}$/)
      .optional(),
    observacoes: z.string().trim().max(500).optional(),
  })
  // .strict() CRÍTICO (seguranca.md §10): rejeita qualquer campo não declarado.
  // Campos monetários (preco/subtotal/desconto/taxa_entrega/total) não existem
  // aqui → qualquer tentativa de injeção via DevTools é bloqueada na entrada.
  .strict()
  // Refinamento condicional: endereço obrigatório apenas quando tipo_entrega='entrega'.
  // Quando 'retirada', servidor força taxa_entrega=0 independentemente (RN-C2).
  .refine(
    (d) => d.tipo_entrega === "retirada" || !!d.endereco_entrega,
    { message: "Endereço obrigatório para entrega", path: ["endereco_entrega"] },
  );

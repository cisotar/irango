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
    produto_id: z.uuid(),
    quantidade: z.number().int().min(1).max(99),
  })
  .strict();

const schemaEnderecoEntrega = z
  .object({
    cep: z.string().regex(/^\d{5}-?\d{3}$/),
    rua: z.string().min(1),
    numero: z.string().min(1),
    bairro: z.string().min(1),
    cidade: z.string().min(1).optional(),
    complemento: z.string().optional(),
  })
  .strict();

export const schemaPayloadPedido = z
  .object({
    loja_id: z.uuid(),
    itens: z.array(schemaItemPedido).min(1),
    endereco_entrega: schemaEnderecoEntrega,
    forma_pagamento: z.enum(["pix", "dinheiro", "link", "cartao"]),
    codigo_cupom: z
      .string()
      .regex(/^[A-Za-z0-9]{3,20}$/)
      .optional(),
    nome_cliente: z.string().trim().min(1).max(120),
    telefone_cliente: z.string().optional(),
    observacoes: z.string().optional(),
  })
  .strict();

// Contrato do PAYLOAD DE CHECKOUT — o que o client de checkout pode enviar.
//
// CRÍTICO (seguranca.md §10): NUNCA inclui campos monetários
// (total/subtotal/frete/desconto). Com `.strict()` na raiz E nos itens,
// qualquer campo desconhecido injetado pelo cliente (ex.: `total: 0.01`) é
// REJEITADO antes de chegar ao servidor. O recálculo é todo do servidor,
// na Server Action `criarPedido` (issue 014) — este schema é só a porta de
// entrada do client. Espelha o padrão anti-fraude de `pedido.ts`.
//
// `z.guid()` (não `z.uuid()`) valida o FORMATO uuid sem exigir os nibbles de
// versão/variante RFC-4122 — alinhado com `schemaPayloadPedido`.

import { z } from "zod";

const schemaItemCheckout = z
  .object({
    produto_id: z.guid(),
    quantidade: z.number().int().min(1),
  })
  .strict();

const schemaEnderecoCheckout = z
  .object({
    cep: z.string(),
    rua: z.string(),
    numero: z.string(),
    bairro: z.string(),
    cidade: z.string(),
    uf: z.string().length(2),
    complemento: z.string().optional(),
  })
  .strict();

export const schemaCheckout = z
  .object({
    loja_id: z.guid(),
    itens: z.array(schemaItemCheckout).min(1),
    endereco: schemaEnderecoCheckout,
    forma_pagamento_id: z.guid(),
    codigo_cupom: z.string().optional(),
    nome: z.string().min(1),
    telefone: z.string().min(1),
    observacoes: z.string().optional(),
  })
  .strict(); // rejeita total/subtotal/frete/desconto injetados pelo cliente

export type PayloadCheckout = z.infer<typeof schemaCheckout>;

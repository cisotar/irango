// schemaFormaPagamento valida a FORMA da config de pagamento do lojista
// (formas_pagamento.tipo + config jsonb) conforme o tipo.
// NÃO confiar no cliente (lojista): uma chave pix malformada faria o comprador
// pagar pra ninguém. Validação server-side antes de persistir.
// FORA daqui: unicidade/RLS no banco, geração de QR code.
import { z } from "zod";

// Chave pix validada conforme o tipo_chave (discriminada dentro do config pix).
const schemaChavePix = z.discriminatedUnion("tipo_chave", [
  z.object({
    tipo_chave: z.literal("cpf"),
    chave: z.string().regex(/^\d{11}$/),
  }),
  z.object({
    tipo_chave: z.literal("cnpj"),
    chave: z.string().regex(/^\d{14}$/),
  }),
  z.object({
    tipo_chave: z.literal("email"),
    chave: z.email(),
  }),
  z.object({
    tipo_chave: z.literal("telefone"),
    chave: z.string().regex(/^\+?55\d{10,11}$/),
  }),
  z.object({
    tipo_chave: z.literal("aleatoria"),
    chave: z.uuid(),
  }),
]);

export const schemaFormaPagamento = z.discriminatedUnion("tipo", [
  z.object({
    tipo: z.literal("pix"),
    config: schemaChavePix,
  }),
  z.object({
    tipo: z.literal("link"),
    config: z.object({ url: z.url() }),
  }),
  z.object({
    tipo: z.literal("dinheiro"),
    config: z.object({}),
  }),
  z.object({
    tipo: z.literal("cartao"),
    config: z.object({}),
  }),
]);

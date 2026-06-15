// schemaFormaPagamento valida a FORMA da config de pagamento do lojista
// (formas_pagamento.tipo + config jsonb) conforme o tipo.
// NÃO confiar no cliente (lojista): uma chave pix malformada faria o comprador
// pagar pra ninguém. Validação server-side antes de persistir.
// FORA daqui: unicidade/RLS no banco, geração de QR code.
import { z } from "zod";
import { STORAGE_URL_PREFIX, schemaStorageUrl } from "./storage";

// STORAGE_URL_PREFIX vive em ./storage (módulo neutro, plano 072). Re-exportado
// aqui para não quebrar quem o importa de pagamento.ts.
export { STORAGE_URL_PREFIX };

/** Valida o QR do Pix como URL do Storage do iRango (campo opcional). */
export const schemaPixQrUrl = schemaStorageUrl.optional();

// Chave pix validada conforme o tipo_chave (discriminada dentro do config pix).
const schemaChavePix = z.discriminatedUnion("tipo_chave", [
  z.object({
    tipo_chave: z.literal("cpf"),
    chave: z.string().regex(/^\d{11}$/),
    pix_qr_url: schemaPixQrUrl,
  }),
  z.object({
    tipo_chave: z.literal("cnpj"),
    chave: z.string().regex(/^\d{14}$/),
    pix_qr_url: schemaPixQrUrl,
  }),
  z.object({
    tipo_chave: z.literal("email"),
    chave: z.email(),
    pix_qr_url: schemaPixQrUrl,
  }),
  z.object({
    tipo_chave: z.literal("telefone"),
    chave: z.string().regex(/^\+?55\d{10,11}$/),
    pix_qr_url: schemaPixQrUrl,
  }),
  z.object({
    tipo_chave: z.literal("aleatoria"),
    chave: z.uuid(),
    pix_qr_url: schemaPixQrUrl,
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

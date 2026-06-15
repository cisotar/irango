// Módulo neutro de validação de URLs do Supabase Storage do iRango (decisão do
// plano 072). O prefixo público é o MESMO para qualquer bucket (`pix-qr`,
// `produtos`, …) — não é por-bucket. Vive aqui (e não em pagamento.ts) porque o
// conceito é de Storage, não de Pix: foto de produto e QR de pagamento reusam o
// mesmo refine anti-injeção de URL externa.
import { z } from "zod";

/** URL base pública do Storage do iRango (deriva de NEXT_PUBLIC_SUPABASE_URL). */
export const STORAGE_URL_PREFIX =
  process.env.NEXT_PUBLIC_SUPABASE_URL + "/storage/v1/object/public/";

/**
 * Valida que a URL é http(s) bem-formada E pertence ao Storage do iRango
 * (startsWith STORAGE_URL_PREFIX) — barra URL externa, `javascript:` e bucket de
 * outro projeto antes de qualquer persistência. SEM `.optional()`/`.nullish()`
 * embutido: a opcionalidade/nulabilidade é composta no ponto de uso (pix usa
 * `.optional()`, produto usa `.nullish()`).
 */
export const schemaStorageUrl = z
  .string()
  .url()
  .refine(
    (url) => url.startsWith(STORAGE_URL_PREFIX),
    "URL deve pertencer ao Storage do iRango.",
  );

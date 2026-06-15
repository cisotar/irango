// Schema Zod do INPUT da Server Action validarCupom (uso, NÃO cadastro).
// Reusa cupomSchema.shape.codigo (trim/uppercase + regex) para normalizar o
// código digitado. Rejeita UUID malformado e subtotal NaN/negativo/Infinity
// ANTES de bater no banco.
import { z } from "zod";
import { cupomSchema } from "@/lib/validacoes/cupom";

export const validarCupomInput = z.object({
  // z.guid(): qualquer UUID com formato válido, espelhando o tipo `uuid` do
  // Postgres (igual produto.ts), sem exigir versão/variante RFC.
  lojaId: z.guid(),
  // Mesma normalização/validação do código usada no cadastro (não duplica).
  codigo: cupomSchema.shape.codigo,
  // Subtotal em REAIS (numeric(10,2) — mesma unidade de calcularDesconto/calcularTotal):
  // finito e não-negativo (rejeita NaN/Infinity/negativo).
  subtotal: z.number().nonnegative().finite(),
});

export type EntradaValidarCupom = z.infer<typeof validarCupomInput>;

// Fonte ÚNICA do entitlement de impressão (issue 130). PURA, sem I/O e sem
// import de client Supabase — recebe a loja já lida sob RLS/loader. Reusada por
// painel (136) e admin (137): um único caminho de decisão.
//
// RN-M1 (server-autoritativo, fail-closed): esta função decide o que a loja pode
// imprimir. Qualquer dúvida sobre a flag → NÃO habilita. Um bug que liberasse uma
// variante não contratada = burla de entitlement (motivo da criticidade).
// RN-M2 (mapa módulo→variantes): Módulo A → "a4"; Módulo B → "cozinha" + "recibo".
//
// Fail-closed com comparação ESTRITA `=== true` (espelha decidirAcessoPainel):
// só o booleano literal `true` habilita. `1`, `"true"`, `undefined`, `null` e
// `loja === null` NÃO habilitam.
import type { LojaCompleta } from "@/lib/supabase/queries/lojas";

export type VarianteImpressao = "a4" | "cozinha" | "recibo";

export function variantesHabilitadas(
  loja: Pick<
    LojaCompleta,
    "modulo_impressao_a4" | "modulo_impressao_termica"
  > | null,
): VarianteImpressao[] {
  if (loja === null) {
    return [];
  }

  const variantes: VarianteImpressao[] = [];

  // Ordem estável: a4 → cozinha → recibo.
  if (loja.modulo_impressao_a4 === true) {
    variantes.push("a4");
  }
  if (loja.modulo_impressao_termica === true) {
    variantes.push("cozinha", "recibo");
  }

  return variantes;
}

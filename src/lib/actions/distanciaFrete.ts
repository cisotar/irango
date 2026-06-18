// Issue 006 — helper NEUTRO (sem 'use server'): FONTE ÚNICA da sequência
// buscarCoordsLoja → geocodificarEndereco(CEP) → haversine, reusada pelo
// autoritativo (criarPedido, 006) e pelo preview (calcularFreteAction, 007):
// paridade RN-7. Módulo neutro porque 'use server' só pode exportar funções
// async destinadas a serem Server Actions (MEMORY: const exportada quebra no
// next build). Aqui, server-only por transitividade (geocodificarEndereco é
// "server-only" e buscarCoordsLoja exige service_role).
//
// FAIL-CLOSED (RN-5, seguranca.md §12-A): retorna `undefined` em QUALQUER falha
// ou pré-condição ausente — loja sem coords (RN-3), CEP ausente, geocoding null.
// NUNCA lança. `undefined` propaga para EnderecoEntrega.distanciaKm → zona
// 'raio_km' não casa → calcularFrete cai no fallback. distanciaKm jamais vem do
// cliente. NÃO arredonda (haversine cru — auditoria fiel; UI arredonda se preciso).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { buscarCoordsLoja } from "@/lib/supabase/queries/lojas";
import { geocodificarEndereco } from "@/lib/utils/geocodificarEndereco";
import { haversine } from "@/lib/utils/haversine";

/**
 * Distância em km (linha reta) entre a loja e o CEP do cliente, para alimentar
 * zonas de frete tipo 'raio_km' em calcularFrete. Recebe `svc` (service_role) por
 * param — coords não têm SELECT anon (§19); não instancia client nem lê process.env.
 */
export async function distanciaDaLojaAoCep(
  svc: SupabaseClient<Database>,
  lojaId: string,
  cep: string | null | undefined,
): Promise<number | undefined> {
  // CEP ausente/vazio → nada a geocodificar (não chama coords nem geocode).
  if (!cep) return undefined;

  try {
    // Coords da loja primeiro: curto-circuito evita bater no Nominatim à toa
    // quando a loja nem tem coords (RN-3).
    const loja = await buscarCoordsLoja(svc, lojaId);
    if (loja == null) return undefined;

    const cliente = await geocodificarEndereco(cep);
    if (cliente == null) return undefined;

    return haversine(
      loja.latitude,
      loja.longitude,
      cliente.latitude,
      cliente.longitude,
    );
  } catch {
    // Fail-closed total: qualquer exceção (ex. buscarCoordsLoja propaga error
    // do PostgREST) vira undefined → zona raio_km não casa → fallback.
    return undefined;
  }
}

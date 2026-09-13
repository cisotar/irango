// Issue 006 — helper NEUTRO (sem 'use server'): FONTE ÚNICA da sequência
// buscarCoordsLoja → geocodificarCepResolvido → haversine, reusada pelo
// autoritativo (criarPedido, 006) e pelo preview (calcularFreteAction, 007):
// paridade RN-7. Módulo neutro porque 'use server' só pode exportar funções
// async destinadas a serem Server Actions (MEMORY: const exportada quebra no
// next build). Aqui, server-only por transitividade (geocodificarCepResolvido é
// "server-only" e buscarCoordsLoja exige service_role).
//
// (185) O CEP é CHAVE de cache, NUNCA a consulta enviada ao provedor: o CEP
// cru resolvia em qualquer lugar do mundo. A consulta vem do endereço
// resolvido no SERVIDOR (ViaCEP), entregue por um thunk memoizado que o
// geocoder só invoca depois do miss de cache.
//
// (190) `resolverEndereco` é passado DIRETO para `geocodificarCepResolvido` —
// a cascata de consultas passou a ser responsabilidade do módulo de
// geocoding, não deste caller (plan/tecnico-geocoding-google.md,
// simplificação de contrato).
//
// FAIL-CLOSED (RN-5, seguranca.md §12-A): retorna `undefined` em QUALQUER falha
// ou pré-condição ausente — loja sem coords (RN-3), CEP ausente, geocoding null.
// NUNCA lança. `undefined` propaga para EnderecoEntrega.distanciaKm → zona
// 'raio_km' não casa → calcularFrete cai no fallback. distanciaKm jamais vem do
// cliente. NÃO arredonda (haversine cru — auditoria fiel; UI arredonda se preciso).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { buscarCoordsLoja } from "@/lib/supabase/queries/lojas";
import { geocodificarCepResolvido } from "@/lib/utils/geocodificarEndereco";
import type { EnderecoCepResolvido } from "@/lib/utils/resolverCepServidor";
import { haversine } from "@/lib/utils/haversine";

/**
 * Distância em km (linha reta) entre a loja e o CEP do cliente, para alimentar
 * zonas de frete tipo 'raio_km' em calcularFrete. Recebe `svc` (service_role) por
 * param — coords não têm SELECT anon (§19); não instancia client nem lê process.env.
 *
 * `resolverEndereco` é OBRIGATÓRIO (convenção da issue 160): um parâmetro
 * opcional deixaria um caller esquecer e cair silenciosamente no caminho
 * quebrado. É um THUNK memoizado pelo caller — só é invocado no miss de cache do
 * geocoder, então cache hit não paga ViaCEP.
 *
 * `ip` também é OBRIGATÓRIO (190/auditoria, achado MÉDIO): repassado direto
 * para `geocodificarCepResolvido`, que o usa como identificador do teto
 * diário SECUNDÁRIO por IP (defesa em profundidade além do teto global —
 * `calcularFreteAction`/`criarPedido` são alcançáveis por cliente anônimo).
 * Os callers (`frete.ts`, `pedido.ts`) já extraem o IP da requisição via
 * `extrairIp(await headers())` para o rate limit existente — é a MESMA
 * string, sem I/O adicional.
 */
export async function distanciaDaLojaAoCep(
  svc: SupabaseClient<Database>,
  lojaId: string,
  cep: string | null | undefined,
  resolverEndereco: () => Promise<EnderecoCepResolvido | null>,
  ip: string,
): Promise<number | undefined> {
  // CEP ausente/vazio → nada a geocodificar (não chama coords nem geocode).
  if (!cep) return undefined;

  try {
    // Coords da loja primeiro: curto-circuito evita bater no Nominatim à toa
    // quando a loja nem tem coords (RN-3).
    const loja = await buscarCoordsLoja(svc, lojaId);
    if (loja == null) return undefined;

    // O CEP é a CHAVE; a CONSULTA (cascata) é montada dentro do geocoder a
    // partir do endereço resolvido no servidor. Se o ViaCEP falhar,
    // `resolverEndereco` devolve null e o geocoder é fail-closed — jamais cai
    // no CEP cru como consulta de consolo (causa raiz da 185).
    const cliente = await geocodificarCepResolvido(cep, resolverEndereco, ip);
    if (cliente.coords == null) return undefined;

    return haversine(
      loja.latitude,
      loja.longitude,
      cliente.coords.latitude,
      cliente.coords.longitude,
    );
  } catch {
    // Fail-closed total: qualquer exceção (ex. buscarCoordsLoja propaga error
    // do PostgREST) vira undefined → zona raio_km não casa → fallback.
    return undefined;
  }
}

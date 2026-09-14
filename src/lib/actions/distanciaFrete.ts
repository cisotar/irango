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
// FAIL-CLOSED (RN-5, seguranca.md §12-A): `km` é `undefined` em QUALQUER falha
// ou pré-condição ausente — loja sem coords (RN-3), CEP ausente, geocoding null.
// NUNCA lança. `undefined` propaga para EnderecoEntrega.distanciaKm → zona
// 'raio_km' não casa → calcularFrete cai no fallback. distanciaKm jamais vem do
// cliente. NÃO arredonda (haversine cru — auditoria fiel; UI arredonda se preciso).
//
// (180-B) O retorno virou DISCRIMINADO (`{ km, causa }`): quem cobra precisa
// saber se a distância "não se aplica" ou "não pôde ser calculada" —
// `classificarFrete` decide, e o veredito a-combinar precede o fallback.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { buscarCoordsLoja } from "@/lib/supabase/queries/lojas";
import { geocodificarCepResolvido } from "@/lib/utils/geocodificarEndereco";
import type { ResolucaoCep } from "@/lib/utils/resolverCepServidor";
import { haversine } from "@/lib/utils/haversine";

// ─────────────────────────── Retorno discriminado (180-B) ───────────────────
// `distanciaDaLojaAoCep` colapsava SETE causas distintas num único `undefined`.
// A jusante, `calcularFrete` não tinha como distinguir "a distância não se
// aplica" de "a distância não pôde ser calculada" — e o fallback fora-de-zona
// (regra de negócio sobre o ENDEREÇO) acabava aplicado a uma falha de
// INFRAESTRUTURA nossa, cobrando o cliente pelo nosso problema.
//
// Fail-closed preservado: `km` só é `number` quando a distância é REAL; a
// função continua NUNCA lançando. O que muda é que a CAUSA deixa de se perder.
// Nenhum dado sensível novo atravessa: a causa é um ENUM e o par (lat,lng)
// continua morrendo dentro do módulo de geocoding (seguranca.md §19).

/**
 * Causa da (in)disponibilidade da distância loja→CEP (180-B/D1).
 *
 * Os literais espelham `MotivoGeocoding` por construção (o motivo do geocoder É
 * a causa). Os três últimos vieram da auditoria de segurança da 180-B e existem
 * justamente para NÃO classificarem como "a combinar" em `classificarFrete`: o
 * caminho a-combinar (taxa_entrega NULL) só pode ser alcançado por falha
 * GENUÍNA do serviço externo — nunca por input do cliente (`cep_inexistente`),
 * nunca pelo nosso throttle (`throttle_interno`), nunca por config quebrada
 * nossa (`indisponivel_config`).
 *
 * (re-auditoria 180-B / MÉDIA B) `esgotado` virou DOIS literais pelo mesmo
 * motivo: o teto diário GLOBAL é orçamento da plataforma (falha nossa de
 * capacidade, inacionável por um comprador sozinho ⇒ a_combinar legítimo),
 * enquanto o teto diário POR IP é a fatia do próprio chamador — ele a esgota
 * com 51 CEPs distintos e se auto-concederia `taxa_entrega` NULL. Só
 * `esgotado_global` fica na lista branca.
 */
export type CausaDistancia =
  | "ok"
  | "sem_cep"
  | "loja_sem_coords"
  | "nao_encontrado"
  | "transitorio"
  | "esgotado_global"
  | "esgotado_ip"
  | "erro"
  | "cep_inexistente"
  | "throttle_interno"
  | "indisponivel_config";

/** Resultado discriminado: distância real só existe com `causa: "ok"`. */
export type ResultadoDistancia =
  | { km: number; causa: "ok" }
  | { km: undefined; causa: Exclude<CausaDistancia, "ok"> };

/**
 * Distância em km (linha reta) entre a loja e o CEP do cliente, para alimentar
 * zonas de frete tipo 'raio_km' em calcularFrete. Recebe `svc` (service_role) por
 * param — coords não têm SELECT anon (§19); não instancia client nem lê process.env.
 *
 * `resolverEndereco` devolve `ResolucaoCep` — o motivo VIAJA junto (180-B,
 * achado 1 da auditoria): "o CEP não existe" (input do cliente) e "o ViaCEP
 * caiu" (canal) precisam chegar distintos ao geocoder, senão o primeiro vira
 * frete a combinar, isto é, frete ZERO a pedido do comprador.
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
  resolverEndereco: () => Promise<ResolucaoCep>,
  ip: string,
): Promise<ResultadoDistancia> {
  // CEP ausente/vazio → nada a geocodificar (não chama coords nem geocode).
  if (!cep) return { km: undefined, causa: "sem_cep" };

  try {
    // Coords da loja primeiro: curto-circuito evita bater no geocoder à toa
    // quando a loja nem tem coords (RN-3).
    const loja = await buscarCoordsLoja(svc, lojaId);
    if (loja == null) return { km: undefined, causa: "loja_sem_coords" };

    // O CEP é a CHAVE; a CONSULTA (cascata) é montada dentro do geocoder a
    // partir do endereço resolvido no servidor. Se o ViaCEP falhar,
    // `resolverEndereco` devolve uma resolução SEM endereço (carregando o
    // motivo) e o geocoder é fail-closed — jamais cai no CEP cru como consulta
    // de consolo (causa raiz da 185).
    const cliente = await geocodificarCepResolvido(cep, resolverEndereco, ip);
    // O motivo do geocoder É a causa (mesmos literais, por construção):
    // repassá-lo é o que impede o fallback fora-de-zona de ser cobrado por uma
    // falha de canal (180-B).
    if (cliente.coords == null) return { km: undefined, causa: cliente.motivo };

    return {
      km: haversine(
        loja.latitude,
        loja.longitude,
        cliente.coords.latitude,
        cliente.coords.longitude,
      ),
      causa: "ok",
    };
  } catch (e) {
    // Fail-closed total: qualquer exceção (ex. buscarCoordsLoja propaga error
    // do PostgREST) NUNCA propaga. `erro` é tratado como retriável pela UI —
    // um blip de banco costuma se resolver em segundos.
    console.error("[distanciaDaLojaAoCep]", e);
    return { km: undefined, causa: "erro" };
  }
}


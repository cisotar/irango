// Geocoding do endereço da LOJA com retry curto, compartilhado por
// `salvarPerfil` (lojista) e `salvarPerfilAdmin` (admin SaaS).
//
// Por que existe (re-auditoria de segurança da 180-B, achado MÉDIA A): as duas
// actions gravam `latitude/longitude` NULL quando o geocoding não devolve
// coords (par tudo-ou-nada, RN-2). Enquanto o único motivo retriável foi
// `transitorio`, a regra de retry duplicada nas duas (na verdade: presente numa
// e AUSENTE na outra) era um débito discreto. Quando a correção do achado 2
// reclassificou "burst negado" de `transitorio` para `throttle_interno`, a
// divergência virou defeito: um throttle NOSSO passou a apagar as coordenadas
// do lojista e a desligar as zonas por raio dele. Fonte ÚNICA, então, para que
// o conjunto de motivos retriáveis não possa divergir de novo entre as duas
// vias.
//
// Nenhum valor monetário passa por aqui: coordenada é insumo GEOGRÁFICO
// derivado no servidor (seguranca.md §19) e o par nunca é logado.

import {
  geocodificarEnderecoComMotivo,
  type ResultadoGeocoding,
} from "@/lib/utils/geocodificarEndereco";

/**
 * Motivos que uma SEGUNDA tentativa imediata pode resolver — e só eles.
 *
 *   - `transitorio`      — o canal externo (Google/ViaCEP) piscou; volta em
 *                          segundos.
 *   - `throttle_interno` — o NOSSO balde de burst (10/s) negou. A janela é de
 *                          1 segundo: esperar ~1,1s e repetir resolve. Sem o
 *                          retry, um throttle nosso apagava as coordenadas já
 *                          gravadas da loja e ainda mandava o lojista conferir
 *                          um endereço que estava certo.
 *
 * Fora da lista de propósito: `nao_encontrado` e `cep_inexistente` (é o DADO
 * que está errado — retentar não acha o inexistente), `esgotado_global` /
 * `esgotado_ip` (tetos DIÁRIOS: só viram na virada do dia) e
 * `indisponivel_config` (falta env var NOSSA — não reaparece em 1,1s; o
 * `console.error` de `configAusente` é o canal certo para isso).
 */
const MOTIVOS_RETRIAVEIS = ["transitorio", "throttle_interno"] as const;

function ehRetriavel(resultado: ResultadoGeocoding): boolean {
  return (
    resultado.coords === null &&
    (MOTIVOS_RETRIAVEIS as readonly string[]).includes(resultado.motivo)
  );
}

// Espera best-effort entre a 1ª tentativa e o retry. O retry só ajuda depois
// que a janela do balde de burst (fixedWindow de 1s) virar — por isso ~1,1s
// antes de disputar o token de novo (seguranca.md §12-A: a trava NÃO é
// afrouxada; só damos tempo a ela). Configurável por env só para os testes
// rodarem sem delay real.
function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Geocodifica `consulta` e, nos motivos retriáveis, tenta UMA única vez mais
 * após a janela da trava virar. `lojaId` isola o balde de burst por loja
 * (re-auditoria 180-B / MÉDIA A) — sem ele, admin e lojistas dividiriam um
 * único balde de 10/s e um estouraria o geocoding do outro.
 *
 * Nunca lança: `geocodificarEnderecoComMotivo` já é fail-closed e devolve
 * sempre um resultado discriminado.
 */
export async function geocodificarLojaComRetry(
  consulta: string,
  lojaId: string,
): Promise<ResultadoGeocoding> {
  const primeira = await geocodificarEnderecoComMotivo(consulta, lojaId);
  if (!ehRetriavel(primeira)) return primeira;

  const atrasoMs = Number(process.env.GEOCODE_RETRY_DELAY_MS ?? 1100);
  await esperar(Number.isFinite(atrasoMs) && atrasoMs >= 0 ? atrasoMs : 1100);
  return geocodificarEnderecoComMotivo(consulta, lojaId);
}

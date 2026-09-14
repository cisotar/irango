// Geocoding CEP/endereço → coordenadas via Google Geocoding API. Util
// server-only que encapsula a chamada externa com `key=` na URL,
// AbortSignal.timeout e uma guarda de custo em duas camadas (issue 190,
// plan/tecnico-geocoding-google.md — troca de provedor Nominatim → Google).
//
// INVERSÃO DE POLÍTICA vs rateLimit.ts — LEIA ANTES DE COPIAR O MOLDE:
//   rateLimit.ts protege o iRango CONTRA o cliente (abuso por IP) → FAIL-OPEN:
//     se o Redis cai, LIBERA (derrubar checkout é pior que perder a trava).
//   Este módulo protege o ORÇAMENTO do iRango (API paga) → FAIL-CLOSED:
//     sem as travas verificadas, não há como contabilizar o gasto, e gastar
//     dinheiro sem conseguir contabilizar é pior que negar uma resolução (que
//     já degrada de forma segura para fora_zona/indisponível).
//   Invariante: toda chamada à Google só sai se TODAS as travas aplicáveis
//   (burst 10/s + teto diário GLOBAL + teto diário POR IP, quando há IP) foram
//   efetivamente verificadas e concedidas. Qualquer estado em que as travas
//   não podem ser verificadas (sem chave, sem credenciais, Redis down,
//   exceção) ⇒ NÃO chamar. O MOTIVO devolvido responde "retentar agora
//   adianta?" (180-B): sem chave/credenciais e tetos diários negados ⇒
//   esgotado; Redis down, burst negado e falhas de canal ⇒ transitorio.
//
//   TETO POR IP (achado MÉDIO do `auditar`, issue 190): o teto diário global
//   sozinho protege o ORÇAMENTO agregado, mas `calcularFreteAction` é um
//   endpoint PÚBLICO sem login — um único atacante pode esgotar o teto
//   global cedo no dia variando CEPs (forçando cache miss), negando o
//   cálculo de frete-por-raio a clientes legítimos da loja pelo resto do
//   dia. Mitigação: um teto diário SECUNDÁRIO, por IP, MAIS BAIXO que o
//   global — nenhum IP sozinho consegue consumir uma fatia desproporcional
//   do orçamento. `ip` chega como PARÂMETRO EXPLÍCITO (nunca lido de
//   contexto de request implícito — este módulo continua sem acesso a
//   `headers()`/cookies; o caller, que já está na fronteira da Server
//   Action e já extrai o IP para `rateLimit.ts`, apenas repassa a mesma
//   string). Só o caminho do CLIENTE (`geocodificarCepResolvido`, chamado a
//   partir de endpoint público anônimo) recebe `ip`; o caminho da LOJA
//   (`geocodificarEnderecoComMotivo`) é usado por um lojista JÁ AUTENTICADO
//   no painel — a Server Action que o chama (`salvarPerfil`) já tem rate
//   limit por IP próprio (`rateLimit.ts`, fail-open, 10/min) e não é o vetor
//   anônimo-em-escala descrito no achado, então não ganhou o parâmetro (YAGNI
//   — evita expandir a superfície de auditoria sem um vetor real a mitigar).
//
// server-only: lê credenciais Upstash (UPSTASH_REDIS_REST_*) e
// GOOGLE_GEOCODING_API_KEY — variáveis sem prefixo público (seguranca.md §7).
// O `import "server-only"` quebra o build se importado de um Client
// Component, garantindo que nada vaze ao bundle.
import "server-only";

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

import { limparCep } from "./buscarCep";
import { dentroDoBrasil, montarConsultasCepCliente } from "./geocodingCepCliente";
import type { EnderecoCepResolvido } from "./resolverCepServidor";

export type Coordenadas = { latitude: number; longitude: number };

/**
 * Versão do VALOR gravado no cache de coordenadas (issue 185, D4/V3; issue
 * 190 sobe para 3). Qualquer valor sem `v === VERSAO_CACHE_GEOCODE` é tratado
 * como MISS — as coordenadas cacheadas em versões anteriores (centroide de
 * cidade, defeito que a 190 corrige) precisam virar MISS incondicional na
 * troca de provedor, sem `DEL` manual em produção.
 */
export const VERSAO_CACHE_GEOCODE = 3;

/**
 * TTL do cache de coordenadas: 25 dias (issue 190, D3). Os Termos de Serviço
 * da Google só permitem cachear lat/lng por até 30 dias consecutivos
 * (https://developers.google.com/maps/documentation/geocoding/policies); 25
 * dias dá margem de segurança contra deriva de relógio/cron e contra o tempo
 * entre "gravado" e "efetivamente expirado" no Redis.
 */
export const TTL_CACHE_GEOCODE_SEGUNDOS = 2_160_000;

// Singleton lazy: Redis.fromEnv() lança se as env vars faltam — só instanciamos
// na primeira chamada com credenciais presentes (igual a rateLimit.ts).
let redisSingleton: Redis | null = null;
let limitadorBurst: Ratelimit | null = null;
let limitadorDiario: Ratelimit | null = null;
let limitadorDiarioIp: Ratelimit | null = null;

function credenciaisUpstash(): boolean {
  return (
    !!process.env.UPSTASH_REDIS_REST_URL && !!process.env.UPSTASH_REDIS_REST_TOKEN
  );
}

function chaveGoogle(): string | null {
  const k = process.env.GOOGLE_GEOCODING_API_KEY?.trim();
  return k ? k : null;
}

function limiteDiario(): number {
  const n = Number(process.env.GEOCODE_GOOGLE_DAILY_LIMIT ?? 500);
  return Number.isFinite(n) && n > 0 ? n : 500;
}

// Default 50 = 10% do default do teto global (500/dia). Justificativa do
// número: generoso para QUALQUER cliente real (mesmo consultando frete para
// várias dezenas de CEPs distintos no mesmo dia, um único visitante
// dificilmente passa de poucas unidades) e, ao mesmo tempo, baixo o
// suficiente para que esgotar o teto GLOBAL sozinho exija pelo menos ~10 IPs
// diferentes — eleva o custo de um ataque de negação de serviço sem exigir
// nada do cliente legítimo. Configurável via GEOCODE_GOOGLE_DAILY_LIMIT_IP
// para permitir ajuste fino sem deploy de código, mesma convenção do teto
// global.
function limiteDiarioIp(): number {
  const n = Number(process.env.GEOCODE_GOOGLE_DAILY_LIMIT_IP ?? 50);
  return Number.isFinite(n) && n > 0 ? n : 50;
}

// Guarda de custo em duas camadas (190/D2), NÃO mais anti-ban:
//   - burst: fixedWindow(10, "1 s") — cautela de sanidade contra picos
//     degenerados (ex.: bug de loop), não uma trava de custo.
//   - diário: fixedWindow(N, "1 d") — a guarda de custo real; N vem de
//     GEOCODE_GOOGLE_DAILY_LIMIT (default 500), expressando mecanicamente o
//     orçamento já aprovado (~$25/mês).
function obterLimitadorBurst(): Ratelimit {
  if (limitadorBurst == null) {
    redisSingleton ??= Redis.fromEnv();
    limitadorBurst = new Ratelimit({
      redis: redisSingleton,
      limiter: Ratelimit.fixedWindow(10, "1 s"),
      prefix: "irango:rl:geocode-google",
    });
  }
  return limitadorBurst;
}

function obterLimitadorDiario(): Ratelimit {
  if (limitadorDiario == null) {
    redisSingleton ??= Redis.fromEnv();
    limitadorDiario = new Ratelimit({
      redis: redisSingleton,
      limiter: Ratelimit.fixedWindow(limiteDiario(), "1 d"),
      prefix: "irango:rl:geocode-google-daily",
    });
  }
  return limitadorDiario;
}

// Teto diário SECUNDÁRIO por IP (190/auditoria, achado MÉDIO) — identificador
// é o IP do chamador (`.limit(ip)`), não uma chave fixa: cada IP tem seu
// próprio balde, isolado dos demais. Prefixo próprio para não colidir com o
// teto global no Redis.
function obterLimitadorDiarioIp(): Ratelimit {
  if (limitadorDiarioIp == null) {
    redisSingleton ??= Redis.fromEnv();
    limitadorDiarioIp = new Ratelimit({
      redis: redisSingleton,
      limiter: Ratelimit.fixedWindow(limiteDiarioIp(), "1 d"),
      prefix: "irango:rl:geocode-google-daily-ip",
    });
  }
  return limitadorDiarioIp;
}

// ── Cache CEP→coords (issue 001, RN-F1..F10) ─────────────────────────────────
// Insumo GEOGRÁFICO apenas (coords do CEP), nunca valor monetário. Usa o MESMO
// redisSingleton das travas (não instancia outro Redis). Política fail-OPEN no
// cache (oposto das travas fail-CLOSED): se o cache cai, ignoramos e seguimos
// para travas+fetch — o cache é otimização, não pré-condição de custo.

function chaveCache(cep: string): string {
  return `irango:geocode:${cep}`;
}

// Aceita o valor do Redis como objeto OU JSON-string (@upstash/redis pode
// devolver qualquer um). Valida Number.isFinite nos dois campos E a versão do
// valor (185/D4/V3, 190 sobe para v3). Qualquer falha/lixo (Redis down, JSON
// inválido, NaN, shape errado, valor legado sem `v` ou com `v` antigo) = miss
// (null).
async function lerCacheCoordenadas(cep: string): Promise<Coordenadas | null> {
  try {
    redisSingleton ??= Redis.fromEnv();
    const bruto = await redisSingleton.get(chaveCache(cep));
    if (bruto == null) return null;
    const obj: unknown = typeof bruto === "string" ? JSON.parse(bruto) : bruto;
    if (typeof obj !== "object" || obj == null) return null;
    const { latitude, longitude, v } = obj as Record<string, unknown>;
    // Valor gravado antes da troca de provedor (sem `v`, ou `v` antigo) pode
    // carregar centroide de cidade → MISS, refaz e sobrescreve a MESMA chave.
    if (v !== VERSAO_CACHE_GEOCODE) return null;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    // Number.isFinite não estreita `unknown` → cast seguro após a guarda acima.
    // Mesmo guard de bounding box aplicado ao par vindo do provedor (187/achado
    // 2): hoje só o caminho pós-guard grava esta versão, mas qualquer par fora
    // do Brasil que chegue à chave por outro caminho (escrita manual, backfill,
    // reuso de VERSAO_CACHE_GEOCODE) viraria distância válida e frete errado por
    // raio. Fora da caixa = MISS: refaz e sobrescreve a MESMA chave.
    if (!dentroDoBrasil(latitude as number, longitude as number)) return null;
    return { latitude: latitude as number, longitude: longitude as number };
  } catch {
    // fail-open: cache indisponível/corrompido → miss; segue travas+fetch.
    return null;
  }
}

// SET versionado COM TTL de 25 dias (190/D3/D4 — substitui o TTL de 180 dias
// da 185). Só no caminho de sucesso (RN-F10 — sem cache negativo). Falha de
// gravação é engolida: o par já foi computado e é retornado normalmente
// (fail-open de escrita).
async function gravarCacheCoordenadas(
  cep: string,
  coords: Coordenadas,
): Promise<void> {
  try {
    redisSingleton ??= Redis.fromEnv();
    await redisSingleton.set(
      chaveCache(cep),
      { ...coords, v: VERSAO_CACHE_GEOCODE },
      { ex: TTL_CACHE_GEOCODE_SEGUNDOS },
    );
  } catch {
    // Engole: gravação é best-effort, não afeta o retorno.
  }
}

/**
 * Motivo da ausência de coords (issue 004; "esgotado" na 180-B). A pergunta
 * que o consumidor precisa responder NÃO é "a falha é permanente?" e sim
 * **"retentar AGORA adianta?"** — 20s de spinner por uma env var faltando é
 * desperdício da atenção do comprador (plan/180-B §D2):
 *   - `transitorio`    — o canal pode voltar em segundos: burst negado,
 *                        timeout, 5xx, status de erro da Google, ViaCEP fora
 *                        do ar. Retentar FAZ sentido.
 *   - `esgotado`       — a trava que negou não se move no curto prazo: teto
 *                        diário global, teto diário por IP, chave da Google
 *                        ausente, credenciais Upstash ausentes. Retentar
 *                        agora NÃO adianta.
 *   - `nao_encontrado` — o problema é o DADO, não o canal: `ZERO_RESULTS`,
 *                        coords não-finitas/fora do Brasil, CEP malformado.
 */
export type MotivoGeocoding = "nao_encontrado" | "transitorio" | "esgotado";

/** Resultado discriminado do geocoding com motivo (issue 004). */
export type ResultadoGeocoding =
  | { coords: Coordenadas }
  | { coords: null; motivo: MotivoGeocoding };

type RespostaGoogleGeocoding = {
  status:
    | "OK"
    | "ZERO_RESULTS"
    | "OVER_QUERY_LIMIT"
    | "REQUEST_DENIED"
    | "INVALID_REQUEST"
    | "UNKNOWN_ERROR"
    | string;
  results?: Array<{ geometry?: { location?: { lat?: unknown; lng?: unknown } } }>;
};

// Portões de guarda de custo + fetch + parse, SEM cache (a decisão de
// cachear é do caller, que é quem tem a chave — 185/D3). `restringirBrasil`
// acrescenta `components=country:BR`; só o caminho do CEP do cliente passa
// `true` (o caminho da loja passa `false`). `ip`, quando presente, ativa o
// teto diário SECUNDÁRIO por IP (190/auditoria) — só o caminho do cliente o
// passa; ausente (caminho da loja) ⇒ só o teto global se aplica, igual a
// antes.
async function consultarGoogle(
  chave: string,
  consulta: string,
  opcoes: { restringirBrasil: boolean; ip?: string },
): Promise<ResultadoGeocoding> {
  try {
    // Burst: cautela de sanidade contra picos degenerados.
    const burst = await obterLimitadorBurst().limit("geocode-burst");
    if (!burst.success) return { coords: null, motivo: "transitorio" };
    // Teto por IP ANTES do global (quando há `ip`): um IP que já esgotou a
    // própria fatia é barrado sem sequer tocar o contador GLOBAL — o que
    // preserva o orçamento agregado para os outros IPs por mais tempo do que
    // checar na ordem inversa (o efeito prático de negar é o mesmo, mas a
    // ordem importa para QUEM fica sem cota primeiro: o abusivo, não o
    // orçamento coletivo).
    if (opcoes.ip) {
      const diarioIp = await obterLimitadorDiarioIp().limit(opcoes.ip);
      // (180-B) `esgotado`, não `transitorio`: a fatia diária deste IP acabou
      // e só volta na virada do dia. Retentar em 10s/20s só queimaria a
      // atenção do comprador. NÃO culpa o cliente na UI — o teto por IP pode
      // ter sido estourado por NAT corporativo/CGNAT móvel (rateLimit.ts).
      if (!diarioIp.success) return { coords: null, motivo: "esgotado" };
    }
    // Teto diário: a guarda de custo real, GLOBAL.
    const diario = await obterLimitadorDiario().limit("geocode-daily");
    // (180-B) `esgotado`: o orçamento diário acabou; retentar agora não adianta.
    if (!diario.success) return { coords: null, motivo: "esgotado" };

    const pais = opcoes.restringirBrasil ? "&components=country:BR" : "";
    const url = `https://maps.googleapis.com/maps/api/geocode/json?key=${chave}&address=${encodeURIComponent(consulta)}${pais}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
    // HTTP não-ok (5xx, 429, etc.): canal indisponível → transitório.
    if (!resp.ok) return { coords: null, motivo: "transitorio" };

    const body = (await resp.json()) as RespostaGoogleGeocoding;
    if (body.status === "ZERO_RESULTS") return { coords: null, motivo: "nao_encontrado" };
    if (body.status !== "OK") {
      // NUNCA loga a chave, a consulta nem o par (lat,lng) — só o `status`.
      console.error("[geocodificarEndereco] status Google:", body.status);
      return { coords: null, motivo: "transitorio" };
    }

    const loc = body.results?.[0]?.geometry?.location;
    // `typeof === "number"`, NUNCA `Number(x)`: `Number(null) === 0` e
    // `Number(false) === 0` são FINITOS, então um `lat`/`lng` ausente-como-null
    // (ou qualquer valor não-numérico coagível a 0) seria aceito como a
    // coordenada real (0,0) — Golfo da Guiné — em vez de cair em
    // `nao_encontrado`. Bug encontrado ao reforçar a cobertura de teste da
    // issue 190 (Number(null) === 0): fix trivial, sem mudar o contrato.
    const latitude = typeof loc?.lat === "number" ? loc.lat : NaN;
    const longitude = typeof loc?.lng === "number" ? loc.lng : NaN;
    // 200/OK com results vazio ou coords não-finitas: dado imprestável.
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return { coords: null, motivo: "nao_encontrado" };
    }

    return { coords: { latitude, longitude } };
  } catch (e) {
    // Genérico no servidor; NUNCA logar o par (lat,lng), a consulta nem a
    // chave (§14/§19/§21). Exceção (limit lança, timeout, fetch reject) =
    // canal indisponível → transitório.
    console.error("[geocodificarEndereco]", e);
    return { coords: null, motivo: "transitorio" };
  }
}

/**
 * Geocodifica uma `consulta` livre ("rua, número, cidade, UF") via Google,
 * retornando o MOTIVO quando não há coords (issue 004). Usada pelo lado da
 * LOJA (salvarPerfil/admin, issue #186 — entra no escopo da 190 por decisão
 * 5 do plano: mesma função de provedor serve loja e cliente), onde o
 * endereço é digitado pelo lojista.
 *
 * NÃO lê nem grava cache (185/D3): cacheabilidade deixou de ser inferida do
 * formato da consulta.
 *
 * Guarda de custo fail-closed (seguranca.md, 190): qualquer estado em que as
 * travas (burst/diária) não puderam ser verificadas/concedidas ⇒ NÃO chama a
 * Google. Esses estados são classificados por "retentar agora adianta?"
 * (180-B): sem chave/credenciais e tetos diários negados ⇒ `esgotado`; burst
 * negado, timeout, HTTP não-ok e status de erro ⇒ `transitorio`; só
 * `ZERO_RESULTS` é `nao_encontrado`. Nunca propaga exceção; nunca loga o par (lat,lng), a
 * consulta nem a chave (§14/§21).
 */
export async function geocodificarEnderecoComMotivo(
  consulta: string,
): Promise<ResultadoGeocoding> {
  // Portão 0: chave da Google é pré-condição — sem ela não há como chamar a
  // API paga. Ausente/vazia → não chama.
  // (180-B) `esgotado`: sem a env var não há chamada possível AGORA; retentar
  // em 10s não conserta uma configuração ausente.
  const chave = chaveGoogle();
  if (!chave) return { coords: null, motivo: "esgotado" };

  // Portão 1: sem credenciais Upstash não há como verificar a guarda de custo
  // → fail-closed. NÃO toca o Redis (oposto de rateLimit.ts, que retornaria
  // permitido:true). (180-B) `esgotado` pelo mesmo motivo do portão 0.
  if (!credenciaisUpstash()) return { coords: null, motivo: "esgotado" };

  // `restringirBrasil: true` (issue 186): toda loja do iRango é brasileira, e
  // sem a restrição nada impedia o endereço digitado pelo lojista de resolver
  // para um ponto fora do país. O caller ainda checa `dentroDoBrasil` no par
  // devolvido — restringir a busca é o primeiro filtro, não o único.
  return consultarGoogle(chave, consulta, { restringirBrasil: true });
}

/**
 * Geocodifica o CEP de um cliente (issue 185; troca de provedor na 190).
 * Dona ÚNICA do cache CEP→coords.
 *
 * A causa raiz da 185 era mandar o CEP CRU como busca livre ao provedor; a da
 * 190 era mandar sempre a MESMA consulta ("<cidade> - <uf>, Brasil") para
 * qualquer CEP da cidade, perdendo toda granularidade abaixo do nível
 * "cidade". Aqui o CEP é só a CHAVE de cache; `resolverEndereco` resolve o
 * endereço no ViaCEP (servidor) e esta função monta a CASCATA de consultas
 * (`montarConsultasCepCliente`, decisão 1 do plano) — do mais específico
 * (logradouro+bairro+cidade-UF) ao mais genérico (cidade-UF, que nunca fica
 * pior que o comportamento anterior à 190). `resolverEndereco` só é invocado
 * DEPOIS do miss de cache, o que mantém o teto de chamadas externas: cache
 * hit ⇒ 0 idas ao ViaCEP e 0 à Google.
 *
 * Ordem OBRIGATÓRIA dos portões (plan/tecnico-geocoding-google.md):
 *   chave Google → credenciais Upstash → GET cache → resolverEndereco
 *   (ViaCEP) → montarConsultasCepCliente (cascata) → para cada candidato:
 *     burst 10/s → teto diário N/dia → fetch Google → ZERO_RESULTS? próximo
 *     candidato : outro status/erro? transitorio/esgotado IMEDIATO (não cascateia em
 *     falha de canal/orçamento) : OK? dentroDoBrasil → SET cache com v:3 e
 *     ex:2_160_000 → retorna.
 *
 * FAIL-CLOSED: `resolverEndereco` retornando `null` (ViaCEP fora do ar, CEP
 * inexistente, resposta sem cidade/UF) ⇒ `transitorio` SEM chamar a Google —
 * jamais cai no CEP cru como consulta de consolo. A cascata só avança em
 * `nao_encontrado` (ZERO_RESULTS); qualquer falha de canal/orçamento
 * (`transitorio` ou `esgotado`) interrompe a cascata imediatamente (retry num canal já degradado
 * dobraria o gasto sem chance real de sucesso).
 *
 * `ip` é OBRIGATÓRIO (convenção da issue 160 — parâmetro opcional deixaria um
 * caller esquecer e reabrir silenciosamente o vetor do achado MÉDIO da
 * auditoria 190): ativa o teto diário SECUNDÁRIO por IP em `consultarGoogle`,
 * mais baixo que o teto global, para que um único IP não-autenticado não
 * consiga esgotar sozinho o orçamento agregado. O caller (`distanciaFrete.ts`,
 * a partir de `frete.ts`/`pedido.ts`) já extrai o IP da requisição para o
 * rate limit existente (`rateLimit.ts`) — aqui é só repassado, NUNCA lido de
 * `headers()`/contexto implícito por este módulo (que continua server-only
 * sem acesso a request). Nunca é logado além do uso como identificador de
 * chave no Redis (a própria lib Upstash trata isso internamente).
 */
export async function geocodificarCepResolvido(
  cep: string,
  resolverEndereco: () => Promise<EnderecoCepResolvido | null>,
  ip: string,
): Promise<ResultadoGeocoding> {
  // Portões 0 e 1: idênticos ao caminho da loja.
  // (180-B) Portões 0/1 → `esgotado` (ver `MotivoGeocoding`): configuração
  // ausente não se resolve em 10s de spinner.
  const chave = chaveGoogle();
  if (!chave) return { coords: null, motivo: "esgotado" };
  if (!credenciaisUpstash()) return { coords: null, motivo: "esgotado" };

  // A chave é o CEP normalizado: com e sem máscara resolvem a MESMA entrada.
  // CEP malformado → nada a resolver, sem NENHUMA I/O externa.
  const digitos = limparCep(cep);
  // (180-B) `nao_encontrado`, não `transitorio`: retentar um CEP inválido NUNCA
  // resolve — o que a UI precisa pedir é conferir o número digitado.
  if (!/^\d{8}$/.test(digitos)) return { coords: null, motivo: "nao_encontrado" };

  // Portão de cache (leitura) ANTES do ViaCEP: é o que sustenta o teto de
  // chamadas. Miss/lixo/Redis down → fail-open, segue (RN-F4/F5 preservados).
  const cacheado = await lerCacheCoordenadas(digitos);
  if (cacheado) return { coords: cacheado };

  let resolvido: EnderecoCepResolvido | null;
  try {
    resolvido = await resolverEndereco();
  } catch (e) {
    // ViaCEP lançou: canal indisponível → transitório, sem propagar exceção.
    console.error("[geocodificarCepResolvido]", e);
    return { coords: null, motivo: "transitorio" };
  }
  // Sem endereço resolvido no servidor não há o que geocodificar. NUNCA cair
  // no CEP cru aqui — é exatamente a regressão que a issue 185 corrige.
  if (!resolvido) return { coords: null, motivo: "transitorio" };

  const candidatos = montarConsultasCepCliente(resolvido);
  // Sem cidade/UF não há âncora geográfica utilizável (defensivo — o próprio
  // ViaCEP já garante cidade/uf quando resolvido != null).
  if (candidatos.length === 0) return { coords: null, motivo: "transitorio" };

  for (const consulta of candidatos) {
    const r = await consultarGoogle(chave, consulta, { restringirBrasil: true, ip });
    if (r.coords == null) {
      // Falha de canal/orçamento: para a cascata imediatamente (180-B:
      // `esgotado` também — insistir com o teto batido não muda o resultado).
      if (r.motivo !== "nao_encontrado") return r;
      // ZERO_RESULTS: tenta o próximo candidato, mais genérico.
      continue;
    }

    // Defesa em profundidade (D1 da 185): par fora do Brasil é falha do dado,
    // não distância válida → nao_encontrado e NADA é gravado (sem cache
    // negativo), sem cascatear (o candidato "funcionou", só o resultado é
    // inválido).
    if (!dentroDoBrasil(r.coords.latitude, r.coords.longitude)) {
      return { coords: null, motivo: "nao_encontrado" };
    }

    await gravarCacheCoordenadas(digitos, r.coords);
    return r;
  }

  // Todos os candidatos exauridos em ZERO_RESULTS.
  return { coords: null, motivo: "nao_encontrado" };
}

// Rate limit por IP nas Server Actions sensíveis (issue 052, seguranca.md §12/§5).
// Wrapper FINO sobre @upstash/ratelimit + @upstash/redis (libs consolidadas — não
// reinventar a roda). É camada de CONTENÇÃO DE ABUSO/CUSTO, não gate de valor ou
// permissão: o gate primário continua sendo RLS + recálculo autoritativo no servidor.
//
// server-only: este módulo lê credenciais Upstash (UPSTASH_REDIS_REST_*) — SEM
// prefixo NEXT_PUBLIC_ (seguranca.md §7). O `import "server-only"` quebra o build
// se ele for importado de um Client Component, garantindo que URL/token nunca
// vazem para o bundle do cliente.
//
// FAIL-OPEN (plano §Casos de Borda): se as credenciais faltam (dev local) ou o
// Redis cai, `verificarRateLimit` engole a exceção, loga no servidor e LIBERA a
// requisição. Derrubar login/checkout porque o Redis caiu é pior que perder a
// trava temporariamente — defesa-em-profundidade, não autoridade.
import "server-only";

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

// Config central por chave de action. Sliding window por IP/minuto.
// Os valores espelham seguranca.md §12 e o escopo da issue 052:
//   login ~5/min · criarPedido ~10/min · validarCupom ~20/min · fretePreview ~20/min.
export const LIMITES = {
  login: { limite: 5, janela: "1 m" },
  criarPedido: { limite: 10, janela: "1 m" },
  validarCupom: { limite: 20, janela: "1 m" },
  fretePreview: { limite: 20, janela: "1 m" },
  salvarPerfil: { limite: 10, janela: "1 m" },
  salvarLogoLoja: { limite: 10, janela: "1 m" },
} as const satisfies Record<string, { limite: number; janela: `${number} m` }>;

export type ChaveRateLimit = keyof typeof LIMITES;

/**
 * Extrai o IP do cliente dos headers da requisição (server-side, NÃO forjável
 * pelo payload). Assume deploy atrás da borda Vercel, que injeta `x-real-ip`
 * com o IP de conexão real e não permite que o cliente o sobrescreva.
 *
 * Ordem: `x-real-ip` (Vercel, não forjável) → último elemento de
 * `x-forwarded-for` (proxy de borda, não o primeiro que o cliente controla) →
 * `"desconhecido"` (ambiente sem proxy).
 *
 * ATENÇÃO: usar o PRIMEIRO elemento de x-forwarded-for é vulnerável a bypass —
 * o cliente envia header arbitrário e cada valor cria um balde Upstash distinto.
 * O ÚLTIMO elemento é appendado pelo proxy e não é controlado pelo cliente.
 */
export function extrairIp(headers: Headers): string {
  // x-real-ip: Vercel sobrescreve com o IP de conexão real — não forjável.
  const real = headers.get("x-real-ip")?.trim();
  if (real) return real;
  // Fallback: último elemento do XFF (appendado pelo proxy de borda).
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const partes = xff.split(",").map((p) => p.trim()).filter(Boolean);
    const ultimo = partes.at(-1);
    if (ultimo) return ultimo;
  }
  return "desconhecido";
}

// ──────────────────────────────────────────────────────────────────────────
// Singleton lazy do Redis + cache de Ratelimit por chave. NÃO instanciamos no
// topo do módulo: `Redis.fromEnv()` lança se as env vars faltarem, e queremos
// fail-open silencioso (dev local sem Upstash roda normalmente). A instância só
// nasce na primeira chamada com credenciais presentes.
let redisSingleton: Redis | null = null;
const limitadores = new Map<ChaveRateLimit, Ratelimit>();
let avisouSemCredenciais = false;

function credenciaisPresentes(): boolean {
  return (
    !!process.env.UPSTASH_REDIS_REST_URL && !!process.env.UPSTASH_REDIS_REST_TOKEN
  );
}

function obterRedis(): Redis {
  if (redisSingleton == null) {
    redisSingleton = Redis.fromEnv();
  }
  return redisSingleton;
}

function obterLimitador(chave: ChaveRateLimit): Ratelimit {
  let limitador = limitadores.get(chave);
  if (limitador == null) {
    const { limite, janela } = LIMITES[chave];
    limitador = new Ratelimit({
      redis: obterRedis(),
      limiter: Ratelimit.slidingWindow(limite, janela),
      prefix: `irango:rl:${chave}`,
    });
    limitadores.set(chave, limitador);
  }
  return limitador;
}

/**
 * Verifica a trava de rate limit para `identificador` (IP) na `chave` da action.
 *   - dentro do limite (Upstash success:true)  → { permitido: true }
 *   - excedeu (Upstash success:false)           → { permitido: false }
 *   - sem credenciais / Redis indisponível/erro → { permitido: true } (FAIL-OPEN)
 *
 * O detalhe do erro NUNCA vaza ao cliente: log no servidor, retorno booleano.
 */
export async function verificarRateLimit(
  chave: ChaveRateLimit,
  identificador: string,
): Promise<{ permitido: boolean }> {
  // Sem credenciais (dev local): desativa a trava e avisa uma vez. Não toca o Redis.
  if (!credenciaisPresentes()) {
    if (!avisouSemCredenciais) {
      avisouSemCredenciais = true;
      console.warn(
        "[rateLimit] UPSTASH_REDIS_REST_* ausente — rate limit DESATIVADO (fail-open).",
      );
    }
    return { permitido: true };
  }

  try {
    const { success } = await obterLimitador(chave).limit(identificador);
    return { permitido: success };
  } catch (e) {
    // FAIL-OPEN: Redis caiu/timeout → libera, mas registra no servidor.
    console.error("[rateLimit]", e);
    return { permitido: true };
  }
}

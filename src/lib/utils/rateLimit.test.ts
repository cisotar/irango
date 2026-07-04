import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
// Testes de rate limit (issue 052, crítica).
//
// Contrato sob teste:
//   - extrairIp(headers: Headers): string
//       x-real-ip (Vercel, não forjável) -> último de x-forwarded-for -> "desconhecido"
//       NUNCA usa o primeiro elemento de x-forwarded-for (controlado pelo cliente).
//   - verificarRateLimit(chave, identificador): Promise<{ permitido: boolean }>
//       Upstash success:true  -> { permitido: true }   (dentro do limite)
//       Upstash success:false -> { permitido: false }  (excedeu o limite)
//       erro/env ausente      -> { permitido: true }    (fail-open, defesa-em-prof.)
//
// @upstash/ratelimit e @upstash/redis são mockados via vi.mock. Nenhuma rede real.
// ---------------------------------------------------------------------------

// `limit` controla o success de cada chamada; os testes redefinem por cenário.
const limitMock = vi.fn();

vi.mock("@upstash/ratelimit", () => {
  // Ratelimit é instanciado como `new Ratelimit({...})`; expomos um stub cuja
  // instância chama o limitMock controlado pelo teste. `slidingWindow` é
  // referenciado na config de LIMITES, então precisa existir como estático.
  class Ratelimit {
    limit = limitMock;
    static slidingWindow = vi.fn(() => ({ __sliding: true }));
  }
  return { Ratelimit };
});

vi.mock("@upstash/redis", () => {
  class Redis {
    static fromEnv = vi.fn(() => new Redis());
  }
  return { Redis };
});

import { extrairIp, verificarRateLimit, LIMITES } from "./rateLimit";

const ENV_BACKUP = { ...process.env };

beforeEach(() => {
  limitMock.mockReset();
  vi.restoreAllMocks();
  // Por padrão as credenciais Upstash EXISTEM (caminho com rate limit ativo).
  process.env.UPSTASH_REDIS_REST_URL = "https://exemplo.upstash.io";
  process.env.UPSTASH_REDIS_REST_TOKEN = "token-fake";
});

afterEach(() => {
  process.env = { ...ENV_BACKUP };
});

// ---------------------------------------------------------------------------
// extrairIp — função pura, sem rede. Assume deploy atrás da borda Vercel.
// x-real-ip: Vercel injeta o IP real de conexão e não permite que o cliente
// sobrescreva este header — é a fonte mais confiável.
// x-forwarded-for: o cliente controla o PRIMEIRO elemento (bypass trivial);
// o ÚLTIMO é appendado pelo proxy de borda e não é forjável pelo cliente.
// ---------------------------------------------------------------------------
describe("extrairIp — fonte do identificador (server-side, não forjável)", () => {
  it("prioriza x-real-ip (Vercel, não forjável pelo cliente)", () => {
    const h = new Headers({
      "x-real-ip": "198.51.100.42",
      "x-forwarded-for": "1.2.3.4, 5.6.7.8",
    });
    expect(extrairIp(h)).toBe("198.51.100.42");
  });

  it("usa o ÚLTIMO elemento de x-forwarded-for quando x-real-ip ausente (proxy de borda)", () => {
    const h = new Headers({ "x-forwarded-for": "203.0.113.7, 70.41.3.18, 150.172.238.178" });
    // 203.0.113.7 é o IP declarado pelo cliente — forjável. 150.172.238.178 é o proxy.
    expect(extrairIp(h)).toBe("150.172.238.178");
  });

  it("faz trim dos IPs em x-forwarded-for ao pegar o último elemento", () => {
    const h = new Headers({ "x-forwarded-for": "203.0.113.7,  150.172.238.178  " });
    expect(extrairIp(h)).toBe("150.172.238.178");
  });

  it("retorna 'desconhecido' sem nenhum header de IP (ambiente sem proxy)", () => {
    const h = new Headers();
    expect(extrairIp(h)).toBe("desconhecido");
  });
});

// ---------------------------------------------------------------------------
// LIMITES — config central por chave (plano §Arquivos). Garante que as chaves
// que as actions vão usar existem; um typo aqui quebraria silenciosamente o guard.
// ---------------------------------------------------------------------------
describe("LIMITES — chaves de rate limit por action", () => {
  it("expõe as chaves usadas pelas actions", () => {
    expect(Object.keys(LIMITES).sort()).toEqual(
      [
        "criarPedido",
        "fretePreview",
        "login",
        "salvarLogoLoja",
        "salvarPerfil",
        "statusPedido",
        "validarCupom",
      ].sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// verificarRateLimit — trava por IP com Upstash mockado.
// ---------------------------------------------------------------------------
describe("verificarRateLimit — trava por IP (Upstash mockado)", () => {
  it("DENTRO do limite (success:true) → { permitido: true }", async () => {
    limitMock.mockResolvedValue({ success: true });

    const r = await verificarRateLimit("login", "203.0.113.7");

    expect(r).toEqual({ permitido: true });
    expect(limitMock).toHaveBeenCalledWith("203.0.113.7");
  });

  it("EXCEDEU o limite (success:false) → { permitido: false }", async () => {
    limitMock.mockResolvedValue({ success: false });

    const r = await verificarRateLimit("login", "203.0.113.7");

    expect(r).toEqual({ permitido: false });
  });

  it("FAIL-OPEN: erro do Upstash (Redis caiu) → { permitido: true } e loga no servidor", async () => {
    const erroSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    limitMock.mockRejectedValue(new Error("ECONNREFUSED upstash"));

    const r = await verificarRateLimit("criarPedido", "203.0.113.7");

    // Derrubar checkout porque o Redis caiu é pior que perder a trava
    // temporariamente — rate limit é defesa-em-profundidade, não gate de valor.
    expect(r).toEqual({ permitido: true });
    expect(erroSpy).toHaveBeenCalled();
  });

  it("FAIL-OPEN: sem env UPSTASH_* (dev local) → { permitido: true } sem chamar o Redis", async () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const r = await verificarRateLimit("validarCupom", "203.0.113.7");

    expect(r).toEqual({ permitido: true });
    // Sem credenciais, não há por que tocar o Redis.
    expect(limitMock).not.toHaveBeenCalled();
  });

  // ── Borda 1: IP "desconhecido" (ambiente sem proxy) conta no limite ──────────
  // Sem headers de IP, extrairIp() retorna "desconhecido". Esse string precisa
  // ser passado ao Upstash como identificador — não descartado silenciosamente.
  // Se múltiplos clientes sem proxy compartilhassem o mesmo bucket "desconhecido",
  // ainda assim a trava funciona e impede abusos em ambientes sem proxy reverso.
  it('IP "desconhecido" (sem headers) é passado ao Upstash e conta no limite', async () => {
    limitMock.mockResolvedValue({ success: true });

    const r = await verificarRateLimit("login", "desconhecido");

    // Upstash foi chamado — não foi silenciado por ser "desconhecido".
    expect(limitMock).toHaveBeenCalledWith("desconhecido");
    expect(r).toEqual({ permitido: true });
  });

  it('IP "desconhecido" excedendo o limite → { permitido: false } (igual a qualquer IP)', async () => {
    limitMock.mockResolvedValue({ success: false });

    const r = await verificarRateLimit("login", "desconhecido");

    expect(r).toEqual({ permitido: false });
    expect(limitMock).toHaveBeenCalledWith("desconhecido");
  });

  // ── Borda 2: fail-open não propaga exceção de NENHUMA origem ─────────────────
  // O try/catch em verificarRateLimit engloba obterLimitador + obterRedis + .limit().
  // Este teste simula um erro síncrono antes de .limit() (ex.: Redis retornou payload
  // inesperado que quebrou o parsing interno). A exceção não deve escapar ao chamador
  // da action — fail-open em qualquer caminho de erro, não só rejeição de Promise.
  it("FAIL-OPEN: exceção síncrona dentro de .limit() (TypeError, não só rede) → { permitido: true }", async () => {
    const erroSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    limitMock.mockImplementation(() => {
      throw new TypeError("cannot read property 'success' of undefined");
    });

    const r = await verificarRateLimit("fretePreview", "203.0.113.7");

    expect(r).toEqual({ permitido: true });
    expect(erroSpy).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Não-vazamento de credencial: as envs Upstash são SEM prefixo NEXT_PUBLIC_
// (seguranca.md §7). O bundle do cliente nunca recebe URL nem token do Redis.
// ---------------------------------------------------------------------------
describe("não-vazamento de credenciais Upstash ao cliente", () => {
  it("o código-fonte do módulo não referencia NEXT_PUBLIC_UPSTASH_*", async () => {
    const { readFile } = await import("node:fs/promises");
    const src = await readFile(new URL("./rateLimit.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/NEXT_PUBLIC_UPSTASH/);
  });
});

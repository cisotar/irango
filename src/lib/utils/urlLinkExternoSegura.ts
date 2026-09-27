import type { z } from "zod";

import { urlHttpsSegura } from "./urlHttpsSegura";

// Especialização de domínio do guard anti-XSS §15 (seguranca.md) para o LINK da
// mensagem do modal sazonal (spec modal-sazonal-mensagem-formatada, RN-M12).
// Mesmo molde de `fotoSegura`: delega primeiro à fonte única `urlHttpsSegura`
// (um predicado, sem divergência) e só então aplica as regras de FORMATO.
//
// Usado pelo zod na escrita e na leitura (`schemaMensagemModal`), pelo campo do
// editor e pelo `AvisoSaidaLink` no render (todo `href` vindo do banco passa
// pelo guard onde é renderizado). Função pura, sem I/O, sem throw.

/** Teto do valor BRUTO recebido (RN-M08), medido antes de qualquer parse. */
export const TETO_URL_BRUTA = 2048;
/** Teto do `href` CANÔNICO (RN-M08), medido depois da canonização WHATWG. */
export const TETO_URL_CANONICA = 1000;

/** URL https canônica que atravessou `urlLinkExternoSegura`. Só nasce aqui. */
export type LinkExternoValidado = string & z.BRAND<"LinkExternoValidado">;

const RE_IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

function hostnameAceito(hostname: string): boolean {
  // IPv6 literal: o parser mantém os colchetes (`[::1]`).
  if (hostname.startsWith("[")) return false;
  // IPv4 em qualquer notação (decimal, hex, octal, curta) já chega aqui
  // normalizado pelo parser WHATWG para a forma pontuada.
  if (RE_IPV4.test(hostname)) return false;
  if (hostname === "localhost" || hostname.endsWith(".localhost")) return false;
  const rotulos = hostname.split(".");
  if (rotulos.length < 2) return false;
  const final = rotulos[rotulos.length - 1];
  return final !== "" && !/^\d+$/.test(final);
}

/**
 * Valida e canoniza um link externo da mensagem (RN-M12, passos 1–8).
 *
 * @param bruto valor não confiável (payload, linha do banco, campo do editor).
 * @returns o `href` canônico (hostname IDN em punycode) ou `null`.
 */
export function urlLinkExternoSegura(bruto: unknown): LinkExternoValidado | null {
  if (typeof bruto !== "string") return null;
  // 1. teto bruto ANTES de qualquer parse (CWE-770).
  if (bruto.length > TETO_URL_BRUTA) return null;
  // 2. fonte única: começa exatamente com `https://`.
  const https = urlHttpsSegura(bruto);
  if (https === null) return null;
  // 3. parser WHATWG, e o protocolo conferido de novo depois dele.
  let url: URL;
  try {
    url = new URL(https);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  // 4. sem credencial (`https://irango.vercel.app@golpe.com`).
  if (url.username !== "" || url.password !== "") return null;
  // 5. sem porta explícita.
  if (url.port !== "") return null;
  // 6. sem IP literal, sem localhost, com ponto e rótulo final não numérico.
  if (!hostnameAceito(url.hostname)) return null;
  // 7. canônico (punycode feito pelo parser) com teto próprio.
  const canonico = url.href;
  if (canonico.length > TETO_URL_CANONICA) return null;
  // 8. o que se grava e se renderiza é sempre o canônico.
  return canonico as LinkExternoValidado;
}

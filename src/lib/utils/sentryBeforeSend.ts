import type { ErrorEvent, EventHint } from "@sentry/nextjs";

/**
 * Scrubber de PII e segredos para eventos do Sentry (§seguranca.md — scrubbing
 * obrigatório). Roda em `beforeSend` no client, server e edge. Remove dados
 * pessoais (LGPD) e qualquer credencial ANTES do evento sair do processo.
 *
 * Função pura e exaustivamente testável: recebe um evento, devolve uma cópia
 * sanitizada. Nunca lança — se algo der errado na sanitização, é melhor
 * descartar o evento do que vazar PII, então retornamos `null` em caso de erro.
 */

// Nomes de campo PII conhecidos do domínio iRango. Comparação case-insensitive.
const CAMPOS_PII = [
  "email",
  "telefone",
  "whatsapp",
  "nome_cliente",
  "telefone_cliente",
  "nomecliente",
  "telefonecliente",
  "chave_pix",
  "chavepix",
  "pix",
  "cpf",
  "cnpj",
  "endereco",
  "cep",
  // Dados de comprador Hotmart
  "hotmart_subscriber_code",
  "subscriber_code",
  "subscribercode",
  "buyer",
  "comprador",
];

// Substrings que indicam credencial/segredo em QUALQUER campo. Barra
// service_role_key, auth tokens, etc. (§segurança: secrets nunca no Sentry).
const SUBSTRINGS_SEGREDO = ["key", "secret", "token", "password", "senha", "authorization", "cookie", "hottok"];

const MASCARA = "[Filtered]";

function ehChaveSensivel(chave: string): boolean {
  const k = chave.toLowerCase();
  if (CAMPOS_PII.includes(k)) return true;
  return SUBSTRINGS_SEGREDO.some((sub) => k.includes(sub));
}

/**
 * Sanitiza recursivamente um valor, mascarando qualquer chave sensível.
 * `seen` evita loop em referências circulares.
 */
function sanitizar(valor: unknown, seen: WeakSet<object>): unknown {
  if (valor === null || typeof valor !== "object") return valor;

  if (seen.has(valor as object)) return MASCARA;
  seen.add(valor as object);

  if (Array.isArray(valor)) {
    return valor.map((item) => sanitizar(item, seen));
  }

  const resultado: Record<string, unknown> = {};
  for (const [chave, val] of Object.entries(valor as Record<string, unknown>)) {
    if (ehChaveSensivel(chave)) {
      resultado[chave] = MASCARA;
    } else {
      resultado[chave] = sanitizar(val, seen);
    }
  }
  return resultado;
}

/**
 * `beforeSend` do Sentry. Aplica o scrubber a todo o payload (extra, contexts,
 * tags, request, user, breadcrumbs). Retorna `null` para descartar o evento se
 * a sanitização falhar — fail-closed para não vazar PII.
 */
export function sentryBeforeSend(
  event: ErrorEvent,
  _hint?: EventHint,
): ErrorEvent | null {
  try {
    const sanitizado = sanitizar(event, new WeakSet()) as ErrorEvent;
    // `sendDefaultPii: false` já evita captura de IP/cookies, mas garantimos.
    if (sanitizado.user) {
      delete sanitizado.user.ip_address;
      delete sanitizado.user.email;
    }
    if (sanitizado.request) {
      delete sanitizado.request.cookies;
      if (sanitizado.request.headers) {
        delete (sanitizado.request.headers as Record<string, unknown>).cookie;
        delete (sanitizado.request.headers as Record<string, unknown>).authorization;
      }
    }
    return sanitizado;
  } catch (erro) {
    // Não confiamos no payload parcialmente sanitizado: descartamos.
    console.error("[sentry] beforeSend falhou ao sanitizar evento", erro);
    return null;
  }
}

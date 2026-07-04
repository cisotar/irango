"use server";

// Server Action de POLLING de status do pedido (issue 128 — crítica).
//
// O cliente (issue 131) chama esta action a cada 8s para acompanhar o status do
// pedido. Leitura MÍNIMA por posse do token: retorna SÓ { status, tipo_entrega }.
// Nenhuma PII (nome/telefone/endereço/itens/valores) trafega no polling.
//
// Segurança:
//   - Autorização por POSSE DO TOKEN (senha do pedido): validada na query
//     escopada `WHERE id AND token_acesso` sob service_role. Nenhuma regra vive
//     no cliente.
//   - Anti-enumeração (§6): par errado / id inexistente / uuid inválido → mesma
//     resposta genérica `{ encontrado: false }` — indistinguíveis entre si.
//   - service_role só no servidor — RLS deny-all de `pedidos` para anon intacta.
//   - Erro interno → log no servidor, retorno genérico (seguranca.md §14).

import { z } from "zod";
import { headers } from "next/headers";
import { createServiceClient } from "@/lib/supabase/service";
import { buscarPedidoPorToken } from "@/lib/supabase/queries/pedidos";
import { verificarRateLimit, extrairIp } from "@/lib/utils/rateLimit";
import type { StatusPedido } from "@/lib/utils/transicaoStatus";

// z.guid() valida o FORMATO uuid sem exigir nibbles de versão RFC-4122 (mesmo
// padrão de queries/pedidos.ts e validacoes/pedido.ts) — evita rejeitar ids
// válidos do Postgres.
const schemaUuid = z.guid();

// Union discriminada — `type` (não `const`), então não viola a restrição de
// export de Server Action (só funções async exportadas).
export type ResultadoStatusPedido =
  | { encontrado: true; status: StatusPedido; tipo_entrega: string }
  | { encontrado: false };

/** Resposta genérica de falha — idêntica para inválido/inexistente/erro. */
function naoEncontrado(): ResultadoStatusPedido {
  return { encontrado: false };
}

/**
 * Lê o status de um pedido por posse do token (polling do cliente, 8s).
 *
 * @param pedidoId  UUID do pedido
 * @param token     UUID do token de acesso (senha do pedido)
 * @returns `{ encontrado: true, status, tipo_entrega }` ou `{ encontrado: false }`
 *
 * A autorização é a posse do token, garantida na query escopada por
 * `(id, token_acesso)` sob service_role. Par errado é indistinguível de
 * inexistente (anti-enumeração).
 */
export async function consultarStatusPedido(
  pedidoId: string,
  token: string,
): Promise<ResultadoStatusPedido> {
  // 1) Valida input (uuid) antes de qualquer I/O — formato inválido não toca o
  //    banco (defesa em profundidade; buscarPedidoPorToken também guarda).
  if (
    !schemaUuid.safeParse(pedidoId).success ||
    !schemaUuid.safeParse(token).success
  ) {
    return naoEncontrado();
  }

  try {
    // 2) Rate limit server-side por IP — o intervalo de 8s do cliente é só UX;
    //    a trava real contra polling abusivo vive aqui (mesmo shape genérico).
    const ip = extrairIp(await headers());
    const { permitido } = await verificarRateLimit("statusPedido", ip);
    if (!permitido) {
      return naoEncontrado();
    }

    // 3) Leitura escopada por (id, token) via service_role.
    const svc = createServiceClient();
    const pedido = await buscarPedidoPorToken(svc, pedidoId, token);

    // 4) Par errado / inexistente → mesma resposta genérica (anti-enumeração).
    if (pedido == null) {
      return naoEncontrado();
    }

    // 5) Projeção mínima — descarta PII/itens/valores.
    return {
      encontrado: true,
      status: pedido.status as StatusPedido,
      tipo_entrega: pedido.tipo_entrega,
    };
  } catch (e) {
    // Erro interno nunca vaza ao cliente (§14): log no servidor, retorno
    // genérico — mesmo shape que "não encontrado", não vaza existência.
    console.error("[consultarStatusPedido]", e);
    return naoEncontrado();
  }
}

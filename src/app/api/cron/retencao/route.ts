import { timingSafeEqual } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/service";

// `timingSafeEqual` exige runtime Node (não Edge); `force-dynamic` impede cache
// de uma rota com efeito destrutivo.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Agendador das funções de retenção da LGPD (issue 349).
 *
 * As duas rotinas existem no banco com EXECUTE só para `service_role`
 * (`20261002120000_clientes.sql`, `20261003123000_anonimizar_cliente_pedidos.sql`),
 * mas nada as executava periodicamente — a Política de Privacidade promete a
 * retenção. `pg_cron` ficou fora: a extension não existe no pglite e o projeto
 * veda `create extension` em migration (`20260614000129_schema_inicial.sql:4`),
 * o que deixaria o agendamento sem nenhuma cobertura de teste.
 *
 * Invocado pelo cron da Vercel (`vercel.json`), que envia
 * `Authorization: Bearer $CRON_SECRET` e só roda em deploy de produção.
 */
type Rotina = "anonimizar_clientes_inativos" | "expurgar_pedidos_antigos";

/**
 * Comparação tempo-constante do header contra `Bearer <segredo>`. Mesmo padrão
 * de `validarHottok` (`lib/utils/hotmart.ts`): nunca `===` (vaza timing), nunca
 * lança (comprimentos diferentes retornam `false`) e sem segredo configurado
 * retorna `false` — fail-closed, nunca autoriza às cegas.
 */
function autorizadoCron(header: string | null, segredo: string | undefined): boolean {
  if (!header || !segredo) return false;
  const recebido = Buffer.from(header, "utf8");
  const esperado = Buffer.from(`Bearer ${segredo}`, "utf8");
  if (recebido.length !== esperado.length) return false;
  return timingSafeEqual(recebido, esperado);
}

/**
 * Roda uma rotina e devolve a contagem, ou `null` se falhou. Cada rotina é
 * independente: falha na anonimização não pode impedir o expurgo (as duas são
 * obrigação de retenção separada).
 */
async function executar(
  svc: ReturnType<typeof createServiceClient>,
  rotina: Rotina,
): Promise<number | null> {
  const { data, error } = await svc.rpc(rotina);
  if (error) {
    // Só `code` e `message`: `details`/`hint` do Postgres ecoam valor de linha e
    // estas rotinas varrem PII (nome, telefone, endereço).
    console.error(`[cron-retencao] ${rotina} falhou`, {
      code: error.code,
      message: error.message,
    });
    return null;
  }
  return data;
}

export async function GET(request: Request): Promise<Response> {
  if (!autorizadoCron(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return Response.json({ erro: "nao autorizado" }, { status: 401 });
  }

  let svc: ReturnType<typeof createServiceClient>;
  try {
    svc = createServiceClient();
  } catch (e) {
    console.error("[cron-retencao] service client indisponivel", e);
    return Response.json({ erro: "erro interno" }, { status: 500 });
  }

  const anonimizados = await executar(svc, "anonimizar_clientes_inativos");
  const expurgados = await executar(svc, "expurgar_pedidos_antigos");

  // Contagens são agregados, não PII.
  console.log("[cron-retencao]", { anonimizados, expurgados });

  const falhou = anonimizados === null || expurgados === null;
  return Response.json({ anonimizados, expurgados }, { status: falhou ? 500 : 200 });
}

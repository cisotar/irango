import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { StatusAssinatura } from "@/lib/utils/assinatura";

type Client = SupabaseClient<Database>;

/**
 * Aplica um override administrativo de billing numa loja (issue 080), via
 * service_role (BYPASSRLS — passa pelo trigger lojas_protege_billing_trg).
 * Sempre seta `assinatura_atualizada_em` (auditoria). `fimPeriodo`:
 *   - `Date`      → seta `assinatura_fim_periodo` para esse instante (corte);
 *   - `null`      → seta `assinatura_fim_periodo = NULL` (cortesia);
 *   - `undefined` → NÃO toca a coluna (reativar).
 * Retorna a quantidade de linhas afetadas (0 = loja inexistente).
 */
export async function aplicarStatusAdmin(
  client: Client,
  lojaId: string,
  status: StatusAssinatura,
  fimPeriodo: Date | null | undefined,
): Promise<{ linhasAfetadas: number }> {
  const patch: Database["public"]["Tables"]["lojas"]["Update"] = {
    assinatura_status: status,
    assinatura_atualizada_em: new Date().toISOString(),
  };
  if (fimPeriodo !== undefined) {
    patch.assinatura_fim_periodo = fimPeriodo ? fimPeriodo.toISOString() : null;
  }
  const { count, error } = await client
    .from("lojas")
    .update(patch, { count: "exact" })
    .eq("id", lojaId);
  if (error) throw error;
  return { linhasAfetadas: count ?? 0 };
}

/** Linha da tela admin (issue 082) — só leitura, PII restrita ao dono do SaaS. */
export type AssinanteLinha = {
  id: string;
  nome: string;
  emailDono: string | null;
  status: string;
  planoNome: string | null;
  inicio: string | null;
  fimPeriodo: string | null;
  billingProvider: string | null;
};

/**
 * Lista TODAS as lojas com dados de assinatura para a tela admin (RN-13), via
 * service_role (sem RLS de dono — admin vê todas). O `verificarAdminSaaS()` é a
 * ÚNICA defesa: chame-o ANTES, no guard da rota.
 *
 * O e-mail do dono vive em `auth.users` (não em `lojas`) — buscado em lote pelo
 * Admin API (`auth.admin.listUsers`) e casado por `dono_id`. Se o lookup de
 * e-mail falhar, a linha aparece sem e-mail (não derruba a lista — auditoria > UX).
 */
export async function listarAssinantes(
  client: Client,
): Promise<AssinanteLinha[]> {
  const { data, error } = await client
    .from("lojas")
    .select(
      "id, nome, dono_id, assinatura_status, assinatura_inicio, assinatura_fim_periodo, billing_provider, planos ( nome )",
    )
    .order("criado_em", { ascending: false });
  if (error) throw error;

  const emailPorDono = await mapearEmailsDosDonos(client);

  return (data ?? []).map((loja) => {
    const plano = loja.planos as { nome: string } | { nome: string }[] | null;
    const planoNome = Array.isArray(plano) ? (plano[0]?.nome ?? null) : (plano?.nome ?? null);
    return {
      id: loja.id,
      nome: loja.nome,
      emailDono: emailPorDono.get(loja.dono_id) ?? null,
      status: loja.assinatura_status,
      planoNome,
      inicio: loja.assinatura_inicio,
      fimPeriodo: loja.assinatura_fim_periodo,
      billingProvider: loja.billing_provider,
    };
  });
}

/** dono_id → email, via Admin API paginada. Fail-soft: erro → mapa vazio. */
async function mapearEmailsDosDonos(
  client: Client,
): Promise<Map<string, string>> {
  const mapa = new Map<string, string>();
  try {
    let pagina = 1;
    // perPage máx. do GoTrue. Loja-base é pequena; 2-3 páginas no pior caso.
    const porPagina = 1000;
    for (;;) {
      const { data, error } = await client.auth.admin.listUsers({
        page: pagina,
        perPage: porPagina,
      });
      if (error) throw error;
      for (const u of data.users) {
        if (u.email) mapa.set(u.id, u.email);
      }
      if (data.users.length < porPagina) break;
      pagina += 1;
    }
  } catch (e) {
    console.error("[listarAssinantes] lookup de e-mails falhou", e);
  }
  return mapa;
}

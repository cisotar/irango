import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables, TablesInsert } from "@/lib/database.types";

/**
 * Queries reusáveis de `lojas` (issue 023). Acesso centralizado respeitando RLS.
 * NUNCA `.from('lojas')` inline em outro lugar — use estas funções.
 *
 * Todas recebem o `Client` por parâmetro (testabilidade + escolha de role pelo caller).
 * Não criam client nem leem `process.env`.
 *
 * Tratamento de erro (seguranca.md §14): propagam o `error` do PostgREST.
 * `null`/`false`/`0` significam "sem linha" — NUNCA mascaram erro.
 */
type Client = SupabaseClient<Database>;

/** Row da VIEW `vitrine_lojas` — colunas públicas, sem dados sensíveis. */
export type LojaPublica = Tables<"vitrine_lojas">;

/** Row da TABELA `lojas` — loja completa (uso do dono). */
export type LojaCompleta = Tables<"lojas">;

/**
 * Vitrine pública por id (role anon). Fonte: VIEW `vitrine_lojas`.
 * Usada p/ obter `taxa_entrega_fora_zona` no preview de frete (issue 072) sem
 * precisar de service_role. Loja inativa/inexistente → `null`.
 */
export async function buscarLojaPublicaPorId(
  client: Client,
  lojaId: string,
): Promise<LojaPublica | null> {
  const { data, error } = await client
    .from("vitrine_lojas")
    .select("*")
    .eq("id", lojaId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Vitrine pública (SSR, role anon). Fonte: VIEW `vitrine_lojas` (já filtra `ativo = true`).
 * NUNCA a tabela `lojas`. Loja inativa/inexistente → `null`.
 */
export async function buscarLojaPorSlug(
  client: Client,
  slug: string,
): Promise<LojaPublica | null> {
  const { data, error } = await client
    .from("vitrine_lojas")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Painel: a loja do lojista autenticado. Fonte: TABELA `lojas` (RLS `lojas_leitura_propria`
 * — escopo `auth.uid() = dono_id`). Dono sem loja / não autenticado → `null`.
 */
export async function buscarLojaDoDono(client: Client): Promise<LojaCompleta | null> {
  const { data, error } = await client.from("lojas").select("*").maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Checagem autoritativa de unicidade de slug. Fonte: TABELA `lojas`.
 * Exige client **service_role** (BYPASSRLS) — precisa enxergar lojas inativas, que
 * a view esconde. O factory service_role é injetado pelo caller (issue 030).
 * `exceto` = id da própria loja, ignorado na contagem (permite salvar sem trocar slug).
 */
export async function slugExiste(
  client: Client,
  slug: string,
  exceto?: string,
): Promise<boolean> {
  let query = client.from("lojas").select("id").eq("slug", slug);
  if (exceto !== undefined) {
    query = query.neq("id", exceto);
  }
  const { data, error } = await query;
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

/**
 * Loja por id para o recálculo autoritativo de pedido (issue 014). Fonte:
 * TABELA `lojas` (não a view `vitrine_lojas`, que esconde `ativo`/`horarios`/
 * `timezone`/`assinatura_*` necessários a `lojaAberta`/`assinaturaPermiteAcesso`).
 *
 * EXIGE client **service_role** (BYPASSRLS) injetado pelo caller (Server Action
 * 014): precisa enxergar a loja mesmo inativa para barrá-la no guard da action.
 * O payload do pedido traz `loja_id` (não slug). Loja inexistente → `null`.
 */
export async function buscarLojaParaPedido(
  client: Client,
  lojaId: string,
): Promise<LojaCompleta | null> {
  const { data, error } = await client
    .from("lojas")
    .select("*")
    .eq("id", lojaId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Loja-alvo por id para o PAINEL ADMIN SaaS (onboarding assistido, issue 096).
 * Fonte: TABELA base `lojas` — NÃO a view `vitrine_lojas`, que filtra `ativo = true`
 * e esconderia justamente a loja em onboarding (`ativo = false`) que o admin precisa
 * configurar. Espelha `buscarLojaParaPedido` (também lê a base): projeta a row
 * completa (perfil, endereço, horários, tema, ativo, slug, ...) que o hub/abas usam.
 *
 * EXIGE client **service_role** (BYPASSRLS) injetado pelo caller (loader `carga.ts`):
 * `lojas` não tem SELECT anon, e a RLS por dono não enxergaria a loja-alvo. Escopado
 * por `eq("id", lojaId)`. Loja inexistente → `null` (o loader trata como notFound).
 * Propaga o `error` do PostgREST (seguranca.md §14).
 */
export async function buscarLojaAdminPorId(
  client: Client,
  lojaId: string,
): Promise<LojaCompleta | null> {
  const { data, error } = await client
    .from("lojas")
    .select("*")
    .eq("id", lojaId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Mapeia comprador→loja pelo e-mail do DONO (issue 057, webhook Hotmart). Fonte:
 * função SQL `public.loja_por_email_dono` (SECURITY DEFINER) — o vínculo está em
 * `auth.users.email`, que NÃO é tabela PostgREST, logo `.from('auth.users')` não
 * funciona nem com service_role.
 *
 * EXIGE client **service_role**: a função só tem `grant execute` para service_role
 * (anon/authenticated não mapeiam e-mail→loja — PII + vínculo dono↔loja). O e-mail
 * já vem normalizado (lower/trim) pelo caller; a função também faz `lower()` nos
 * dois lados. Comprador sem loja → `null` (reconciliação fica p/ issue 059).
 *
 * Propaga o `error` do PostgREST (seguranca.md §14).
 */
export async function buscarLojaPorEmailDono(
  client: Client,
  email: string,
): Promise<LojaCompleta | null> {
  const { data, error } = await client
    .rpc("loja_por_email_dono", { p_email: email })
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Contagem autoritativa de lojas de um dono (RN-01: uma loja por dono).
 * Fonte: TABELA `lojas`. Exige client **service_role** — RLS esconderia lojas de
 * outro `auth.uid()`. Injetado pelo caller (issue 030).
 */
export async function contarLojasDoDono(client: Client, donoId: string): Promise<number> {
  const { count, error } = await client
    .from("lojas")
    .select("*", { count: "exact", head: true })
    .eq("dono_id", donoId);
  if (error) throw error;
  return count ?? 0;
}

/**
 * Loja de um dono por `dono_id` (issue 066). Vínculo canônico dono↔loja — usado
 * na reconciliação pós-confirmação de email, resolvendo a loja pelo `user.id`
 * AUTENTICADO, NUNCA por email (que seria input não-canônico).
 *
 * Exige client **service_role**: roda no callback de confirmação, onde a RLS
 * (`auth.uid() = dono_id`) pode não enxergar a sessão de forma síncrona. Dono sem
 * loja → `null`. Propaga o `error` do PostgREST (seguranca.md §14).
 */
export async function buscarLojaPorDono(
  client: Client,
  donoId: string,
): Promise<{ id: string } | null> {
  const { data, error } = await client
    .from("lojas")
    .select("id")
    .eq("dono_id", donoId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * INSERT autoritativo de loja no cadastro (issue 015). Encapsula a escrita
 * (NUNCA `.from('lojas').insert` inline — DRY de queries, architecture.md §8).
 *
 * Exige client **service_role**: roda logo após o `signUp`, quando o cookie de
 * sessão pode não estar disponível de forma síncrona, e a RLS de INSERT
 * (`auth.uid() = dono_id`) ainda não enxergaria a sessão. O `dados` já vem
 * montado pela action — `dono_id` do retorno do signUp, consentimento/trial
 * decididos pelo servidor (o client nunca envia esses campos).
 *
 * Propaga o `error` do PostgREST (seguranca.md §14) — a action trata 23505
 * (corrida de slug / índice único de dono).
 */
export async function criarLoja(
  client: Client,
  dados: TablesInsert<"lojas">,
): Promise<LojaCompleta> {
  const { data, error } = await client.from("lojas").insert(dados).select("*").single();
  if (error) throw error;
  return data;
}

/**
 * Auto-cura de user órfão (issue 065): garante que o dono autenticado tenha loja,
 * via a função SQL `garantir_loja_do_dono` (SECURITY DEFINER, fonte ÚNICA de "como
 * nasce uma loja" — trial + consentimento + ativo=false decididos server-side).
 *
 * IDEMPOTENTE (RN-01): se a loja já existe, devolve o id existente sem criar nada;
 * em corrida, o índice único lojas(dono_id) garante exatamente 1 loja.
 *
 * Exige client **service_role**: a função é REVOKE de anon/authenticated e só
 * GRANT a service_role. `donoId` é o `user.id` AUTENTICADO (getUser server-side),
 * nunca input do browser; `versaoTermos` é a constante do servidor.
 */
export async function garantirLojaDoDono(
  client: Client,
  donoId: string,
  email: string,
  versaoTermos: string,
): Promise<string> {
  const { data, error } = await client.rpc("garantir_loja_do_dono", {
    p_dono_id: donoId,
    p_email: email,
    p_versao_termos: versaoTermos,
  });
  if (error) throw error;
  return data;
}

/**
 * Persiste as colunas billing-intent da loja após a Server Action criar/trocar a
 * assinatura no provider (issue 078): `billing_provider`, `provider_subscription_id`
 * e `plano_id`. NUNCA toca `assinatura_status` (RN-2/RN-7 — só o webhook 077 é a
 * autoridade de status; o objeto `dados` é tipado para impedir isso).
 *
 * EXIGE client **service_role**: o trigger `lojas_protege_billing` (migration 074)
 * BLOQUEIA essas colunas para o role autenticado — UPDATE via PostgREST autenticado
 * levanta exception. O escopo é manual por `id`, e `lojaId` é DERIVADO da loja do
 * `auth.uid()` (lida antes pela action via RLS), NUNCA do payload do cliente.
 *
 * Propaga o `error` do PostgREST (seguranca.md §14).
 */
export async function persistirAssinaturaLoja(
  client: Client,
  lojaId: string,
  dados: {
    billing_provider: string;
    provider_subscription_id: string;
    plano_id: string;
  },
): Promise<void> {
  const { error } = await client
    .from("lojas")
    .update({
      billing_provider: dados.billing_provider,
      provider_subscription_id: dados.provider_subscription_id,
      plano_id: dados.plano_id,
    })
    .eq("id", lojaId);
  if (error) throw error;
}

/**
 * Coords (latitude/longitude) da loja para cálculo de frete por raio (issues 006/007).
 * Fonte: TABELA base `lojas` — a view `vitrine_lojas` NÃO expõe coords por design
 * (spec §Modelos de Dados, seguranca.md §19). Projeta SÓ as duas colunas (minimização).
 *
 * EXIGE client **service_role** (BYPASSRLS) injetado pelo caller: `lojas` não tem
 * SELECT anon (§2/§19) — via anon/view retornaria zero linhas. Consumida pelo preview
 * (`calcularFreteAction`) e pelo autoritativo (`criarPedido`), ambos server-only.
 *
 * Retorna `null` quando a loja não existe OU não tem coords (RN-3: par NULL → zonas
 * raio_km ignoradas silenciosamente). Propaga o `error` do PostgREST (seguranca.md §14).
 */
export async function buscarCoordsLoja(
  client: Client,
  lojaId: string,
): Promise<{ latitude: number; longitude: number } | null> {
  const { data, error } = await client
    .from("lojas")
    .select("latitude, longitude")
    .eq("id", lojaId)
    .maybeSingle();
  if (error) throw error;
  if (data == null || data.latitude == null || data.longitude == null) {
    return null;
  }
  return { latitude: data.latitude, longitude: data.longitude };
}

/**
 * Resolve o `dono_id` (auth.users.id) a partir do e-mail do dono (issue 085).
 * O vínculo e-mail↔id vive em `auth.users`, que NÃO é tabela PostgREST — logo é
 * lido via Admin API (`auth.admin.listUsers`), NO MESMO mecanismo paginado de
 * `mapearEmailsDosDonos` (não há caminho alternativo de acesso ao Admin API).
 *
 * EXIGE client **service_role**: `auth.admin.*` só funciona com a service key.
 * Normaliza trim + lowercase nos DOIS lados do match (caixa/espaços não importam).
 * E-mail inexistente → `null`. NUNCA loga o e-mail cru (PII, scrubbing §21).
 *
 * Ao contrário de `mapearEmailsDosDonos` (fail-soft → mapa vazio), aqui o erro do
 * Admin API PROPAGA (seguranca.md §14) — quem chama precisa distinguir "não existe"
 * (null) de "lookup falhou" (throw).
 */
export async function resolverDonoPorEmail(
  client: Client,
  email: string,
): Promise<string | null> {
  const alvo = email.trim().toLowerCase();

  let pagina = 1;
  // perPage máx. do GoTrue. Loja-base é pequena; 2-3 páginas no pior caso.
  // Mesma paginação de `mapearEmailsDosDonos` (encerra em users.length < porPagina).
  const porPagina = 1000;
  for (;;) {
    const { data, error } = await client.auth.admin.listUsers({
      page: pagina,
      perPage: porPagina,
    });
    if (error) throw error;
    for (const u of data.users) {
      if (u.email && u.email.trim().toLowerCase() === alvo) {
        return u.id;
      }
    }
    if (data.users.length < porPagina) break;
    pagina += 1;
  }
  return null;
}

/**
 * Resolve o e-mail do dono (auth.users) a partir do `dono_id` (issue 151).
 * Direção INVERSA de `resolverDonoPorEmail` (email→id): aqui o id já é conhecido,
 * então usa `auth.admin.getUserById` — GET direto O(1) do GoTrue, sem varrer a
 * base (a paginação de `resolverDonoPorEmail`/`mapearEmailsDosDonos` só existe
 * porque a busca por *e-mail* não tem endpoint direto). Isso EVITA a 3ª cópia do
 * loop paginado em vez de reproduzi-la.
 *
 * EXIGE client **service_role**: `auth.admin.*` só funciona com a service key.
 * Dono inexistente / sem e-mail → `null`. NUNCA loga o e-mail cru (PII, §21).
 * Fail-loud: erro do Admin API PROPAGA (seguranca.md §14) — quem chama distingue
 * "não existe" (null) de "lookup falhou" (throw), como `resolverDonoPorEmail`.
 */
export async function resolverEmailDoDono(
  client: Client,
  donoId: string,
): Promise<string | null> {
  const { data, error } = await client.auth.admin.getUserById(donoId);
  if (error) throw error;
  return data.user?.email ?? null;
}

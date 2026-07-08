import { z } from "zod";
import { revalidatePath } from "next/cache";
import { verificarAdminSaaS, obterAdminUserId } from "@/lib/auth/admin";
import { createServiceClient } from "@/lib/supabase/service";
import type { Database, Json } from "@/lib/database.types";

/**
 * Helper NEUTRO (sem `'use server'`) compartilhado por TODA Server Action admin
 * desta feature (specs/admin-onboarding-assistido.md). Padroniza o início de uma
 * action admin: validar `lojaId` (UUID) server-side → provar admin ANTES de
 * elevar a service_role (fail-closed, D-4) → (futuro) registrar acesso.
 *
 * Por ser neutro, pode ser importado tanto de módulos `'use server'` quanto de
 * helpers — não exporta funções marcadas como server action.
 */

// z.guid() (não z.uuid()): valida formato uuid sem exigir nibbles de versão/variante
// RFC-4122 — alinhado com frete.ts/schemaCheckout/actions.ts do projeto. Centralizado
// aqui para reuso pelas actions admin.
export const lojaIdSchema = z.guid();

type ValidacaoLojaId =
  | { ok: true; lojaId: string }
  | { ok: false };

/**
 * Valida `lojaId` recebido do cliente via `lojaIdSchema` (safeParse). Não-UUID
 * ou valores não-string → `{ ok: false }`. UUID válido → `{ ok: true, lojaId }`.
 */
export function validarLojaIdAdmin(lojaId: unknown): ValidacaoLojaId {
  const parsed = lojaIdSchema.safeParse(lojaId);
  if (!parsed.success) return { ok: false };
  return { ok: true, lojaId: parsed.data };
}

type Svc = ReturnType<typeof createServiceClient>;
type Tabelas = Database["public"]["Tables"];

// Tabelas do schema `public` que têm coluna `loja_id` — derivadas por tipo, sem
// lista manual: o escopo por loja só faz sentido nelas. A tabela `lojas` (escopo
// por `id`) tem o helper dedicado `atualizarLoja`.
type TabelaComLojaId = {
  [K in keyof Tabelas]: Tabelas[K]["Row"] extends { loja_id: string } ? K : never;
}[keyof Tabelas];

// Colunas de `lojas` somente-servidor (billing/assinatura/identidade + consentimento
// LGPD). Espelham o trigger `lojas_protege_billing` (v4, issue 128 + pentest área 3,
// que passou a cobrir consentimento_versao/_em) + a PK `id`. Fonte ÚNICA do guard de
// tipo e do filtro de runtime de `atualizarLoja`. `satisfies` garante que
// renomear/remover coluna quebre aqui.
const CAMPOS_LOJA_SOMENTE_SERVIDOR = [
  "id",
  "dono_id",
  "assinatura_status",
  "assinatura_inicio",
  "assinatura_fim_periodo",
  "assinatura_atualizada_em",
  "hotmart_subscriber_code",
  "hotmart_plano",
  "billing_provider",
  "provider_subscription_id",
  "plano_id",
  "consentimento_versao",
  "consentimento_em",
  // Módulos pagos de impressão (issues 127/128, RN-M3): só o servidor de billing
  // liga. Espelham as colunas protegidas pelo trigger lojas_protege_billing.
  "modulo_impressao_a4",
  "modulo_impressao_termica",
] as const satisfies readonly (keyof Tabelas["lojas"]["Update"])[];

type PatchLojaAdmin = Omit<
  Tabelas["lojas"]["Update"],
  (typeof CAMPOS_LOJA_SOMENTE_SERVIDOR)[number]
>;

/**
 * Wrapper que amarra TODA escrita ao `lojaId` da action admin. Existe para tornar
 * o escopo por tenant IMPOSSÍVEL de esquecer: os helpers injetam `.eq("loja_id")`
 * (+`.eq("id")`) por construção, então nenhuma escrita migrada pode virar
 * cross-tenant por omissão de filtro. Retorna os builders PostgREST — a action
 * segue lendo `count`/`error` e decidindo "não encontrada". Os tipos de retorno
 * são inferidos do supabase-js (não anotados), preservando `data`/`error`/`count`.
 */
// Resposta terminal do PostgREST que as actions consomem (`data`/`error`/`count`).
type RespostaPostgrest = { data: unknown; error: { message: string } | null; count: number | null };
// Builder mínimo "solto": os generics do PostgREST não estreitam sobre um `T`
// genérico, então internamente tratamos o builder por esta interface nominal
// (sem `any`). A segurança de TIPO fica na assinatura pública dos helpers
// (`T extends TabelaComLojaId`, `Omit<Insert,"loja_id">`); a de ESCOPO, no corpo
// (todo helper injeta `.eq`). O cast é isolado num único ponto: `from`.
interface Encadeavel extends PromiseLike<RespostaPostgrest> {
  eq(coluna: string, valor: string): Encadeavel;
  select(colunas?: string): Encadeavel;
  maybeSingle(): PromiseLike<RespostaPostgrest>;
}
interface FromSolto {
  insert(dados: unknown): Encadeavel;
  update(patch: unknown, opts?: { count: "exact" }): Encadeavel;
  delete(opts?: { count: "exact" }): Encadeavel;
  select(colunas?: string): Encadeavel;
}

function criarEscopoLoja(svc: Svc, lojaId: string) {
  // `.bind(svc)` (não `svc.from` solto): `from` é método de protótipo do
  // supabase-js que lê `this.rest` — desacoplado do client, `this` vira
  // undefined e TODA escrita do escopo explode em runtime (incidente de
  // 2026-07-03 em produção; regressão coberta em admin-loja.binding.test.ts).
  const from = svc.from.bind(svc) as unknown as (tabela: string) => FromSolto;
  return {
    /** INSERT com `loja_id` injetado POR ÚLTIMO — payload hostil não sobrescreve o escopo. */
    inserir<T extends TabelaComLojaId>(tabela: T, dados: Omit<Tabelas[T]["Insert"], "loja_id">) {
      return from(tabela).insert({ ...dados, loja_id: lojaId });
    },
    /** UPDATE de linha da loja, escopo duplo `loja_id`+`id`, `count:"exact"`.
     * `patch` é `Omit<Update,"loja_id"|"id">`: o `.eq` escopa QUAL linha, não O QUE
     * se grava — então o wrapper barra POR TIPO re-parentear (loja_id) ou re-chavear
     * (id) a linha por um patch hostil. Simetria com `inserir` (loja_id por último). */
    atualizar<T extends TabelaComLojaId>(
      tabela: T,
      id: string,
      patch: Omit<Tabelas[T]["Update"], "loja_id" | "id">,
    ) {
      return from(tabela).update(patch, { count: "exact" }).eq("loja_id", lojaId).eq("id", id);
    },
    /** DELETE de linha da loja, escopo duplo `loja_id`+`id`, `count:"exact"`. */
    remover<T extends TabelaComLojaId>(tabela: T, id: string) {
      return from(tabela).delete({ count: "exact" }).eq("loja_id", lojaId).eq("id", id);
    },
    /** SELECT de uma linha da loja, escopo duplo, `maybeSingle`. */
    buscarPorId<T extends TabelaComLojaId>(tabela: T, id: string, colunas = "*") {
      return from(tabela).select(colunas).eq("loja_id", lojaId).eq("id", id).maybeSingle();
    },
    /** UPDATE da PRÓPRIA loja (`lojas`), escopo por `id`, `count:"exact"`.
     * `patch` é `PatchLojaAdmin` (Omit das colunas somente-servidor) — barra POR TIPO
     * chamador que passe object-literal com billing/dono/id. Filtro de runtime é o
     * backstop real: `svc` roda como service_role, que BYPASSA o trigger
     * lojas_protege_billing (v3, issue 128), e o guard de tipo é derrotado por `as`/width-subtyping
     * (ex.: admin-perfil casta p/ TablesUpdate). Descarta as chaves somente-servidor da
     * MESMA constante antes do UPDATE. lat/long ficam de fora (coords derivadas no servidor). */
    atualizarLoja(patch: PatchLojaAdmin) {
      const bloqueadas = CAMPOS_LOJA_SOMENTE_SERVIDOR as readonly string[];
      const seguro = Object.fromEntries(
        Object.entries(patch as Record<string, unknown>).filter(
          ([k]) => !bloqueadas.includes(k),
        ),
      );
      return from("lojas").update(seguro, { count: "exact" }).eq("id", lojaId);
    },
  };
}

/** Helpers escopados por `lojaId` — tipos inferidos do supabase-js. */
export type EscopoLoja = ReturnType<typeof criarEscopoLoja>;

type ContextoAdmin = {
  svc: Svc;
  /** Helpers escopados por `lojaId` — preferir a `svc` cru em toda escrita da loja-alvo. */
  escopo: EscopoLoja;
};

/**
 * Prepara o contexto de uma action admin escopada por `lojaId`. Prova de admin
 * (`verificarAdminSaaS`) ANTES de elevar a service_role (`createServiceClient`).
 * Se a prova lança, a exceção PROPAGA (fail-closed, D-4): NUNCA captura, NUNCA
 * vira `{ ok: false }` amigável e o service client NUNCA é criado.
 *
 * Retorna `escopo` (wrapper que injeta `.eq("loja_id")` por construção) além do
 * `svc` cru — este último só para casos que a abstração não cobre (storage,
 * tabelas-filho por `zona_id`, RPC/queries).
 */
export async function prepararContextoAdmin(lojaId: string): Promise<ContextoAdmin> {
  await verificarAdminSaaS();
  const svc = createServiceClient();
  return { svc, escopo: criarEscopoLoja(svc, lojaId) };
}

/**
 * Invalida o cache das rotas afetadas por uma escrita admin na loja-alvo, de forma
 * CONSISTENTE em todas as actions do bloco de onboarding assistido:
 *  - lista de assinantes (`/admin/assinantes`),
 *  - hub/abas da loja-alvo (`/admin/assinantes/${lojaId}`),
 *  - vitrine pública (`/loja/[slug]`, page) — o cardápio/perfil/tema muda lá também.
 *
 * Neutro (sem `'use server'`): só encadeia `revalidatePath`, padrão "bare" do
 * projeto (sem try/catch interno — o dado já foi persistido pela action chamadora).
 */
export function revalidarLojaAdmin(lojaId: string): void {
  revalidatePath("/admin/assinantes");
  revalidatePath(`/admin/assinantes/${lojaId}`);
  revalidatePath("/loja/[slug]", "page");
}

type AcessoAdmin = {
  adminId?: string;
  lojaId: string;
  acao: string;
  entidadeId?: string;
  metadados?: Record<string, unknown>;
};

/**
 * Log de acesso admin (spec "Auditoria / Log de Acesso") — INSERT best-effort em
 * `admin_acessos` (tabela deny-all: só `service_role` escreve). Fire-and-forget:
 * o caller NUNCA dá await e falha de log NUNCA derruba a action chamadora
 * (billing / permissão / PII). Resolve `admin_user_id = adminId ?? obterAdminUserId()`
 * — id autoritativo do dono do SaaS (a prova `verificarAdminSaaS` já rodou em
 * `prepararContextoAdmin` antes de qualquer caller).
 */
export function registrarAcessoAdmin(svc: Svc, acesso: AcessoAdmin): void {
  // Fire-and-forget: o caller NUNCA dá await. `void` marca a intenção e satisfaz
  // no-floating-promises. A IIFE async colapsa o throw síncrono de obterAdminUserId
  // e a rejeição do insert num único try/catch; a promise sempre resolve → zero
  // unhandled-rejection. Log quebrado (env ausente, rede, tabela indisponível)
  // NUNCA propaga para a action de billing/PII que chamou (seguranca.md §14).
  void (async () => {
    try {
      const admin_user_id = acesso.adminId ?? obterAdminUserId(); // fail-closed: pode lançar
      const { error } = await svc.from("admin_acessos").insert({
        admin_user_id,
        loja_id: acesso.lojaId,
        acao: acesso.acao,
        entidade_id: acesso.entidadeId ?? null,
        metadados: (acesso.metadados ?? null) as Json,
      });
      if (error) {
        console.error("[registrarAcessoAdmin] insert falhou (best-effort):", error.message);
      }
    } catch (e) {
      console.error("[registrarAcessoAdmin] falha ao registrar acesso (best-effort)", e);
    }
  })();
}

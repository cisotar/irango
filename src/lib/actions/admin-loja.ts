import { z } from "zod";
import { revalidatePath } from "next/cache";
import { verificarAdminSaaS } from "@/lib/auth/admin";
import { createServiceClient } from "@/lib/supabase/service";
import type { Database } from "@/lib/database.types";

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
  const from = svc.from as unknown as (tabela: string) => FromSolto;
  return {
    /** INSERT com `loja_id` injetado POR ÚLTIMO — payload hostil não sobrescreve o escopo. */
    inserir<T extends TabelaComLojaId>(tabela: T, dados: Omit<Tabelas[T]["Insert"], "loja_id">) {
      return from(tabela).insert({ ...dados, loja_id: lojaId });
    },
    /** UPDATE de linha da loja, escopo duplo `loja_id`+`id`, `count:"exact"`. */
    atualizar<T extends TabelaComLojaId>(tabela: T, id: string, patch: Tabelas[T]["Update"]) {
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
    /** UPDATE da PRÓPRIA loja (tabela `lojas`), escopo por `id`, `count:"exact"`. */
    atualizarLoja(patch: Tabelas["lojas"]["Update"]) {
      return from("lojas").update(patch, { count: "exact" }).eq("id", lojaId);
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
 * Ponto de extensão para o log de acesso admin (spec "Auditoria / Log de Acesso").
 * Hoje é no-op best-effort: nunca lança, sempre retorna void.
 *
 * TODO(issue futura — "Auditoria / Log de Acesso"): persistir o acesso (admin,
 * loja, ação, entidade, metadados, timestamp) numa tabela de auditoria via `svc`.
 */
export function registrarAcessoAdmin(
  // Tipado como `unknown`: o no-op não usa o client. Quando a issue de log o
  // consumir, troca-se por `ReturnType<typeof createServiceClient>`.
  _svc: unknown,
  _acesso: AcessoAdmin,
): void {
  // no-op (ver TODO acima).
}

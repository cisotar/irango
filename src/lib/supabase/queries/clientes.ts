import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/lib/database.types";

/**
 * Queries de `clientes` / `clientes_enderecos` (issue 337). Leitura com o client
 * da SESSÃO (RLS escopa por `auth.uid()`); o `id` passado deve vir de
 * `getUser()`, nunca do payload. Propagam `error` — o chamador decide a
 * mensagem genérica (seguranca.md §14).
 */
type Client = SupabaseClient<Database>;

export type PerfilCliente = Tables<"clientes">;
export type EnderecoCliente = Tables<"clientes_enderecos">;

export const COLUNAS_ENDERECO =
  "id, cliente_id, rotulo, cep, rua, numero, bairro, cidade, uf, complemento, padrao, criado_em";

/** Perfil do próprio usuário, ou `null` se ainda não completou o cadastro. */
export async function buscarPerfilCliente(
  client: Client,
  clienteId: string,
): Promise<PerfilCliente | null> {
  const { data, error } = await client
    .from("clientes")
    .select(
      "id, nome, telefone, data_nascimento, aceita_marketing, consentimento_em, consentimento_versao, criado_em, ultimo_acesso_em",
    )
    .eq("id", clienteId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Endereços do próprio usuário: padrão primeiro, depois do mais antigo. */
export async function listarEnderecosCliente(
  client: Client,
  clienteId: string,
): Promise<EnderecoCliente[]> {
  const { data, error } = await client
    .from("clientes_enderecos")
    .select(COLUNAS_ENDERECO)
    .eq("cliente_id", clienteId)
    .order("padrao", { ascending: false })
    .order("criado_em", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/**
 * `ultimo_acesso_em` (base da retenção de 24 meses). Coluna sem grant de
 * UPDATE para `authenticated`: exige o client service_role. Sem perfil = no-op.
 */
export async function registrarUltimoAcessoCliente(svc: Client, clienteId: string): Promise<void> {
  const { error } = await svc
    .from("clientes")
    .update({ ultimo_acesso_em: new Date().toISOString() })
    .eq("id", clienteId);
  if (error) throw error;
}

// ── base de clientes do lojista (issue 346) ─────────────────────────────────

/**
 * Linha da allowlist de `clientes_da_loja` / `cliente_da_loja` (RETURNS TABLE
 * fechado: sem e-mail, sem ano de nascimento). As funções escopam pela loja de
 * `auth.uid()` — por isso o client TEM de ser o da sessão, nunca service_role.
 */
export type ClienteDaLoja = Database["public"]["Functions"]["clientes_da_loja"]["Returns"][number];

/** Página da base de clientes da loja do usuário logado (ordem: último pedido desc). */
export async function listarClientesDaLoja(
  client: Client,
  { mes, limite, offset }: { mes?: number; limite: number; offset: number },
): Promise<ClienteDaLoja[]> {
  const { data, error } = await client.rpc("clientes_da_loja", {
    ...(mes != null ? { p_mes: mes } : {}),
    p_limite: limite,
    p_offset: offset,
  });
  if (error) throw error;
  return data ?? [];
}

/** Um cliente da base da loja, ou `null` se não pediu nesta loja (→ 404 no chamador). */
export async function buscarClienteDaLoja(
  client: Client,
  clienteId: string,
): Promise<ClienteDaLoja | null> {
  const { data, error } = await client.rpc("cliente_da_loja", { p_cliente_id: clienteId });
  if (error) throw error;
  return data?.[0] ?? null;
}

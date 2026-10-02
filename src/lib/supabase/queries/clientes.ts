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

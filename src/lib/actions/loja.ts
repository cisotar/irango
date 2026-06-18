"use server";

// Server Actions de configuração da loja (issue 030): perfil/slug, horários, tema.
//
// Princípios inegociáveis aplicados aqui:
//  - NÃO confiar no cliente (seguranca.md §10): todo payload passa por safeParse
//    ANTES de qualquer I/O. Schemas são `.strict()` — chave extra reprova.
//  - RN-A5 / allowlist (seguranca.md §2): o patch do UPDATE é montado EXPLÍCITO,
//    coluna a coluna, a partir do dado JÁ validado. Colunas autoritativas
//    (dono_id, ativo, assinatura_*, hotmart_*, consentimento_*, id) JAMAIS entram.
//  - RLS como última linha (seguranca.md §2): o UPDATE roda no client AUTENTICADO
//    (política `lojas_update_proprio`, escopo auth.uid() = dono_id). O service_role
//    (BYPASSRLS) só checa unicidade de slug, escopado manualmente por slug+exceto.
//  - Erro interno não vaza (seguranca.md §14): detalhe vai pro console.error do
//    servidor; o cliente recebe mensagem genérica.

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { buscarLojaDoDono, slugExiste } from "@/lib/supabase/queries/lojas";
import { schemaPerfil, schemaHorarios, schemaTema } from "@/lib/validacoes/loja";
import { extrairIp, verificarRateLimit } from "@/lib/utils/rateLimit";
import { geocodificarEndereco } from "@/lib/utils/geocodificarEndereco";

export type ResultadoSalvar = { ok: true } | { ok: false; erro: string };

// Retorno de salvarPerfil (issue 008, D1): além do ok/erro, sinaliza se o
// geocoding do endereço produziu coordenadas. Obrigatório no ramo de sucesso —
// o cliente (issue 009) avisa quando geocodificado:false. Tipo dedicado para
// NÃO afetar o ResultadoSalvar das outras três actions.
export type ResultadoPerfil =
  | { ok: true; geocodificado: boolean }
  | { ok: false; erro: string };

/**
 * Monta a consulta livre para o Nominatim a partir do endereço JÁ validado.
 * Função interna PURA — não exportada ('use server' só pode exportar funções
 * async; ver MEMORY use-server-export-constraint).
 *
 * Gate de completude (D3): sem `endereco_cidade` E `endereco_estado` não há
 * âncora geográfica mínima → retorna null (caller grava o par NULL, sem chamar
 * o Nominatim). Com o mínimo, monta string rica (mais específico → menos), com
 * "Brasil" fixo no fim para ancorar o país.
 */
function montarConsultaGeocoding(dados: {
  endereco_cidade?: string | null;
  endereco_estado?: string | null;
  endereco_cep?: string | null;
  endereco_rua?: string | null;
  endereco_numero?: string | null;
  endereco_bairro?: string | null;
}): string | null {
  const cidade = dados.endereco_cidade?.trim();
  const estado = dados.endereco_estado?.trim();
  if (!cidade || !estado) return null;

  const rua = dados.endereco_rua?.trim();
  const numero = dados.endereco_numero?.trim();
  const bairro = dados.endereco_bairro?.trim();
  const cep = dados.endereco_cep?.trim();

  const ruaNumero = [rua, numero].filter(Boolean).join(", ");
  const partes = [
    ruaNumero || null,
    bairro || null,
    `${cidade} - ${estado}`,
    cep || null,
    "Brasil",
  ].filter(Boolean);

  return partes.join(", ");
}

/**
 * Revalida a vitrine best-effort: o dado JÁ foi persistido com sucesso, então
 * uma falha na camada de cache NÃO pode rebaixar o resultado para erro. Só loga.
 */
function revalidarVitrine(...slugs: string[]): void {
  for (const slug of slugs) {
    try {
      revalidatePath(`/${slug}`);
    } catch (e) {
      console.error("revalidarVitrine:", e);
    }
  }
}

const ERRO_GENERICO = "Não foi possível salvar. Tente novamente.";
const ERRO_VALIDACAO = "Dados inválidos. Confira os campos e tente novamente.";
const ERRO_SLUG_OCUPADO = "Este endereço (slug) já está em uso por outra loja.";
const ERRO_SEM_LOJA = "Loja não encontrada.";

/**
 * Atualiza o perfil/slug da loja do dono autenticado. Se o slug mudou, checa
 * unicidade via service_role excluindo a própria loja antes de qualquer UPDATE.
 */
export async function salvarPerfil(payload: unknown): Promise<ResultadoPerfil> {
  const ip = extrairIp(await headers());
  const rl = await verificarRateLimit("salvarPerfil", ip);
  if (!rl.permitido) return { ok: false, erro: "Muitas tentativas. Aguarde um instante." };

  const parsed = schemaPerfil.safeParse(payload);
  if (!parsed.success) return { ok: false, erro: ERRO_VALIDACAO };
  const dados = parsed.data;

  try {
    const supabase = await createClient();

    const loja = await buscarLojaDoDono(supabase);
    if (!loja) return { ok: false, erro: ERRO_SEM_LOJA };

    if (dados.slug !== loja.slug) {
      const ocupado = await slugExiste(createServiceClient(), dados.slug, loja.id);
      if (ocupado) return { ok: false, erro: ERRO_SLUG_OCUPADO };
    }

    // Allowlist explícita (RN-A5): só estas colunas podem ser escritas. As coords
    // (latitude/longitude) JAMAIS entram aqui — são derivadas no 2º UPDATE.
    const patch: Record<string, unknown> = {
      nome: dados.nome,
      slug: dados.slug,
    };
    if (dados.telefone !== undefined) patch.telefone = dados.telefone;
    if (dados.whatsapp !== undefined) patch.whatsapp = dados.whatsapp;
    if (dados.endereco_cep !== undefined) patch.endereco_cep = dados.endereco_cep;
    if (dados.endereco_rua !== undefined) patch.endereco_rua = dados.endereco_rua;
    if (dados.endereco_numero !== undefined) patch.endereco_numero = dados.endereco_numero;
    if (dados.endereco_bairro !== undefined) patch.endereco_bairro = dados.endereco_bairro;
    if (dados.endereco_cidade !== undefined) patch.endereco_cidade = dados.endereco_cidade;
    if (dados.endereco_estado !== undefined) patch.endereco_estado = dados.endereco_estado;

    // .eq("id") obrigatório: PostgREST recusa UPDATE sem WHERE (21000), mesmo com
    // RLS escopando a linha. Escopo por id da própria loja (já resolvida acima).
    const { error } = await supabase.from("lojas").update(patch).eq("id", loja.id);
    if (error) throw error;

    // Coords DERIVADAS no servidor (RN-1): o endereço já foi gravado; agora
    // geocodificamos no servidor. 2º UPDATE separado e best-effort (D2) — par
    // tudo-ou-nada (RN-2). Endereço incompleto ou geocoding falho → par NULL,
    // nunca rebaixa o salvamento nem deixa coords órfãs (D3).
    const consulta = montarConsultaGeocoding(dados);
    const coords =
      consulta === null
        ? null
        : await geocodificarEndereco(consulta);
    const coordsPatch =
      coords === null
        ? { latitude: null, longitude: null }
        : { latitude: coords.latitude, longitude: coords.longitude };

    const { error: erroCoords } = await supabase
      .from("lojas")
      .update(coordsPatch)
      .eq("id", loja.id);
    if (erroCoords) throw erroCoords;

    revalidarVitrine(dados.slug, ...(dados.slug !== loja.slug ? [loja.slug] : []));
    return { ok: true, geocodificado: coords !== null };
  } catch (e) {
    console.error("salvarPerfil:", e);
    return { ok: false, erro: ERRO_GENERICO };
  }
}

const ERRO_PERFIL_INCOMPLETO =
  "Complete nome e WhatsApp antes de publicar a loja.";

/**
 * Publica (ativo=true) ou despublica (ativo=false) a vitrine da loja do dono.
 *
 * `ativo` é coluna PROTEGIDA pelo trigger anti-billing (057) — o dono não pode
 * alterá-la via client autenticado. Por isso o flip roda no service_role
 * (BYPASSRLS). Como o service_role ignora RLS, o escopo é reafirmado À MÃO por
 * `id` + `dono_id` da loja JÁ resolvida sob RLS (buscarLojaDoDono no client
 * autenticado) — impede ativar a loja de terceiro mesmo se `id` vazasse.
 *
 * Gate de publicação (não confiar no cliente): exige perfil mínimo (nome +
 * whatsapp) verificado no servidor a partir do banco, nunca do payload.
 */
export async function definirPublicacao(
  publicar: boolean,
): Promise<ResultadoSalvar> {
  try {
    const supabase = await createClient();

    const loja = await buscarLojaDoDono(supabase);
    if (!loja) return { ok: false, erro: ERRO_SEM_LOJA };

    // Perfil mínimo para ir ao ar: nome preenchido + whatsapp cadastrado.
    if (publicar && (!loja.nome?.trim() || !loja.whatsapp)) {
      return { ok: false, erro: ERRO_PERFIL_INCOMPLETO };
    }

    // service_role: trigger 057 bloqueia o dono de mexer em `ativo`. Escopo
    // reafirmado por id + dono_id (BYPASSRLS não tem RLS para conter).
    const { error } = await createServiceClient()
      .from("lojas")
      .update({ ativo: publicar })
      .eq("id", loja.id)
      .eq("dono_id", loja.dono_id);
    if (error) throw error;

    revalidarVitrine(loja.slug);
    return { ok: true };
  } catch (e) {
    console.error("definirPublicacao:", e);
    return { ok: false, erro: ERRO_GENERICO };
  }
}

/** Atualiza apenas a coluna `horarios` da loja do dono autenticado. */
export async function salvarHorarios(payload: unknown): Promise<ResultadoSalvar> {
  const parsed = schemaHorarios.safeParse(payload);
  if (!parsed.success) return { ok: false, erro: ERRO_VALIDACAO };
  const horarios = parsed.data;

  try {
    const supabase = await createClient();

    const loja = await buscarLojaDoDono(supabase);
    if (!loja) return { ok: false, erro: ERRO_SEM_LOJA };

    const patch = { horarios } satisfies Record<string, unknown>;
    // .eq("id") obrigatório: PostgREST recusa UPDATE sem WHERE (21000).
    const { error } = await supabase.from("lojas").update(patch).eq("id", loja.id);
    if (error) throw error;

    revalidarVitrine(loja.slug);
    return { ok: true };
  } catch (e) {
    console.error("salvarHorarios:", e);
    return { ok: false, erro: ERRO_GENERICO };
  }
}

/** Atualiza apenas a coluna `tema` da loja do dono autenticado. */
export async function salvarTema(payload: unknown): Promise<ResultadoSalvar> {
  const parsed = schemaTema.safeParse(payload);
  if (!parsed.success) return { ok: false, erro: ERRO_VALIDACAO };
  const tema = parsed.data;

  try {
    const supabase = await createClient();

    const loja = await buscarLojaDoDono(supabase);
    if (!loja) return { ok: false, erro: ERRO_SEM_LOJA };

    const patch = { tema } satisfies Record<string, unknown>;
    // .eq("id") obrigatório: PostgREST recusa UPDATE sem WHERE (21000).
    const { error } = await supabase.from("lojas").update(patch).eq("id", loja.id);
    if (error) throw error;

    revalidarVitrine(loja.slug);
    return { ok: true };
  } catch (e) {
    console.error("salvarTema:", e);
    return { ok: false, erro: ERRO_GENERICO };
  }
}
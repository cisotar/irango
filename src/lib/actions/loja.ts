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
import type {
  Coordenadas,
  MotivoGeocoding,
} from "@/lib/utils/geocodificarEndereco";
import { geocodificarLojaComRetry } from "@/lib/actions/geocodificarComRetry";
import {
  montarPatchPerfil,
  montarConsultaGeocoding,
  deveRegeocodificar,
  temCoordenadas,
} from "@/lib/actions/patches-loja";

export type ResultadoSalvar = { ok: true } | { ok: false; erro: string };

// Retorno de salvarPerfil (issue 008, D1; estendido na 007): além do ok/erro,
// sinaliza se o geocoding do endereço produziu coordenadas e, quando NÃO produziu,
// o MOTIVO (nao_encontrado = corrija o dado; transitorio = re-salve em instantes).
// O cliente (PerfilClient) usa o motivo para um aviso acionável. Tipo dedicado
// para NÃO afetar o ResultadoSalvar das outras três actions.
export type ResultadoPerfil =
  | { ok: true; geocodificado: boolean; motivo?: MotivoGeocoding }
  | { ok: false; erro: string };

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

    // Allowlist explícita (RN-7): só estas colunas podem ser escritas. As coords
    // (latitude/longitude) JAMAIS entram aqui — são derivadas no 2º UPDATE.
    const patch = montarPatchPerfil(dados);

    // .eq("id") obrigatório: PostgREST recusa UPDATE sem WHERE (21000), mesmo com
    // RLS escopando a linha. Escopo por id da própria loja (já resolvida acima).
    const { error } = await supabase.from("lojas").update(patch).eq("id", loja.id);
    if (error) throw error;

    // (180-A) O 2º UPDATE é CONDICIONAL: só roda quando o endereço mudou de fato
    // (ou quando há coord órfã a limpar). Antes era incondicional, e um save que
    // não tocava o endereço — trocar só o nome — apagava uma localização VÁLIDA
    // se o geocoder estivesse fora do ar. `deveRegeocodificar` compara a CONSULTA
    // do payload com a da loja gravada, pela MESMA montarConsultaGeocoding.
    if (!deveRegeocodificar(dados, loja)) {
      revalidarVitrine(dados.slug, ...(dados.slug !== loja.slug ? [loja.slug] : []));
      return { ok: true, geocodificado: temCoordenadas(loja) };
    }

    // Coords DERIVADAS no servidor (RN-1): o endereço já foi gravado; agora
    // geocodificamos no servidor. 2º UPDATE separado e best-effort (D2) — par
    // tudo-ou-nada (RN-2). Endereço incompleto ou geocoding falho → par NULL,
    // nunca rebaixa o salvamento nem deixa coords órfãs (D3 — que segue valendo,
    // só que agora apenas no ramo "endereço mudou", 180-A).
    //
    // (007, RN-2-B) Usa o helper COM MOTIVO para distinguir falha transitória
    // (re-salvar resolve) de endereço não localizável (dado do lojista). No
    // transitório, tenta UM retry após a janela da trava virar — assim o lojista
    // não fica com o raio quebrado por uma rajada momentânea do Nominatim.
    //
    // (re-auditoria 180-B / MÉDIA A) O conjunto de motivos retriáveis e o
    // isolamento do balde de burst por loja vivem em `geocodificarLojaComRetry`
    // — fonte única compartilhada com `salvarPerfilAdmin`. `throttle_interno`
    // (o NOSSO balde negou) entrou na lista: sem retry ele caía direto no
    // `coordsPatch` NULL, apagando as coordenadas da loja e desligando as zonas
    // por raio por causa de um throttle nosso.
    const consulta = montarConsultaGeocoding(dados);
    let coords: Coordenadas | null = null;
    let motivo: MotivoGeocoding | undefined;
    if (consulta !== null) {
      const geo = await geocodificarLojaComRetry(consulta, loja.id);
      coords = geo.coords;
      if (geo.coords === null) motivo = geo.motivo;
    }
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
    return motivo
      ? { ok: true, geocodificado: false, motivo }
      : { ok: true, geocodificado: coords !== null };
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
 * Gate de publicação (não confiar no cliente): exige perfil mínimo (nome +
 * whatsapp) verificado no servidor a partir do banco, nunca do payload. É uma
 * regra de NEGÓCIO reforçada aqui — NÃO há trigger de banco protegendo `ativo`
 * (o trigger anti-billing 057/074/128 nunca cobriu essa coluna). Logo o gate é
 * best-effort: o dono poderia, via PATCH direto na PRÓPRIA linha (RLS
 * `lojas_update_proprio` permite), publicar a loja incompleta. É auto-dano, sem
 * cross-tenant/dinheiro/escalonamento — aceito como BAIXA (débito 140).
 *
 * O flip roda no service_role (escrita uniforme com o resto do painel). Como o
 * service_role ignora RLS, o escopo é reafirmado À MÃO por `id` + `dono_id` da
 * loja JÁ resolvida sob RLS (buscarLojaDoDono no client autenticado) — impede
 * ativar a loja de terceiro mesmo se `id` vazasse.
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

    // service_role para escrita uniforme; escopo reafirmado por id + dono_id
    // (BYPASSRLS não tem RLS para conter). NÃO há proteção de trigger em `ativo`.
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
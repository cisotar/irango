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
import { carregarProntidaoPublicacao } from "@/lib/supabase/queries/publicacao";
import {
  camposEnderecoFaltando,
  mensagemEnderecoIncompleto,
  mensagemPendencia,
  podePublicarLoja,
} from "@/lib/utils/publicacao";
import { avisoGeocodingPerfil } from "@/lib/utils/avisoGeocoding";

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

/**
 * Revalida o layout do painel best-effort (issue 368, D9/D14): depois de
 * publicar ou de localizar o endereço, o layout pai precisa re-renderizar
 * (chrome completo, aviso D15 some). Layout não re-renderiza em navegação.
 */
function revalidarPainel(): void {
  try {
    revalidatePath("/painel", "layout");
  } catch (e) {
    console.error("revalidarPainel:", e);
  }
}

const ERRO_GENERICO = "Não foi possível salvar. Tente novamente.";
const ERRO_VALIDACAO = "Dados inválidos. Confira os campos e tente novamente.";
const ERRO_SLUG_OCUPADO = "Este endereço (slug) já está em uso por outra loja.";
const ERRO_SEM_LOJA = "Loja não encontrada.";
const ERRO_RATE_LIMIT = "Muitas tentativas. Aguarde um instante.";

/**
 * Atualiza o perfil/slug da loja do dono autenticado. Se o slug mudou, checa
 * unicidade via service_role excluindo a própria loja antes de qualquer UPDATE.
 */
export async function salvarPerfil(payload: unknown): Promise<ResultadoPerfil> {
  const ip = extrairIp(await headers());
  const rl = await verificarRateLimit("salvarPerfil", ip);
  if (!rl.permitido) return { ok: false, erro: ERRO_RATE_LIMIT };

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

/**
 * Publica (ativo=true) ou despublica (ativo=false) a vitrine da loja do dono.
 *
 * Gate ÚNICO de publicação (issue 368/193, D7): ao publicar — inclusive
 * republicar depois de pausar — relê do banco o estado da loja e as contagens
 * (`carregarProntidaoPublicacao`, client AUTENTICADO, `eq("loja_id")` explícito)
 * e decide com `podePublicarLoja`, a mesma regra do admin e dos previews. Nada
 * vem do payload além do booleano. Despublicar nunca passa pelo gate.
 *
 * Limite conhecido (débito 140, D17): NÃO há trigger de prontidão em `ativo`;
 * o dono poderia, via PATCH direto na PRÓPRIA linha (RLS `lojas_update_proprio`
 * permite), publicar a loja incompleta. É auto-dano, sem cross-tenant.
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

    if (publicar) {
      const prontidao = podePublicarLoja(
        await carregarProntidaoPublicacao(supabase, loja),
      );
      if (!prontidao.ok) {
        return { ok: false, erro: mensagemPendencia(prontidao.pendencia) };
      }
    }

    // service_role para escrita uniforme; escopo reafirmado por id + dono_id
    // (BYPASSRLS não tem RLS para conter). O marcador `primeira_publicacao_em`
    // é gravado pelo trigger do banco, nunca por aqui.
    const { error } = await createServiceClient()
      .from("lojas")
      .update({ ativo: publicar })
      .eq("id", loja.id)
      .eq("dono_id", loja.dono_id);
    if (error) throw error;

    revalidarVitrine(loja.slug);
    revalidarPainel();
    return { ok: true };
  } catch (e) {
    console.error("definirPublicacao:", e);
    return { ok: false, erro: ERRO_GENERICO };
  }
}

export type ResultadoLocalizar =
  | { ok: true }
  | { ok: false; erro: string; motivo?: MotivoGeocoding };

/**
 * Botão "Localizar meu endereço de novo" (issue 368/193, D14). Sem argumento:
 * nada vem do cliente. Só age com endereço completo e sem o par; grava SÓ
 * `{ latitude, longitude }` no client autenticado, com compare-and-set (DD13):
 * se o endereço mudou ou outro save já gravou o par durante o geocoding, o
 * UPDATE atinge 0 linhas e nada muda. Falha do geocoder → nada gravado e o
 * `motivo` volta com o texto de `avisoGeocodingPerfil(motivo, "localizar")`.
 * Nunca grava `ativo` nem par nulo.
 */
export async function localizarEnderecoDeNovo(): Promise<ResultadoLocalizar> {
  try {
    const supabase = await createClient();

    const loja = await buscarLojaDoDono(supabase);
    if (!loja) return { ok: false, erro: ERRO_SEM_LOJA };

    // Balde por LOJA (DD12): contém o custo do geocoder externo.
    const rl = await verificarRateLimit("localizarEndereco", loja.id);
    if (!rl.permitido) {
      return { ok: false, erro: ERRO_RATE_LIMIT };
    }

    const faltando = camposEnderecoFaltando(loja);
    if (faltando.length > 0) {
      return { ok: false, erro: mensagemEnderecoIncompleto(faltando) };
    }

    if (temCoordenadas(loja)) {
      revalidarPainel();
      return { ok: true };
    }

    const consulta = montarConsultaGeocoding(loja);
    // Endereço completo ⇒ consulta não nula (paridade travada por teste); o
    // ramo existe só como defesa.
    if (consulta === null) {
      return { ok: false, erro: mensagemEnderecoIncompleto(faltando) };
    }

    const geo = await geocodificarLojaComRetry(consulta, loja.id);
    if (geo.coords === null) {
      return {
        ok: false,
        motivo: geo.motivo,
        erro: avisoGeocodingPerfil(geo.motivo, "localizar"),
      };
    }

    // Compare-and-set (DD13): só grava se o par segue ausente e o endereço da
    // consulta (os 5 campos; o CEP não entra, issue 186) não mudou.
    const { error, count } = await supabase
      .from("lojas")
      .update(
        { latitude: geo.coords.latitude, longitude: geo.coords.longitude },
        { count: "exact" },
      )
      .eq("id", loja.id)
      .is("latitude", null)
      .eq("endereco_rua", loja.endereco_rua ?? "")
      .eq("endereco_numero", loja.endereco_numero ?? "")
      .eq("endereco_bairro", loja.endereco_bairro ?? "")
      .eq("endereco_cidade", loja.endereco_cidade ?? "")
      .eq("endereco_estado", loja.endereco_estado ?? "");
    if (error) throw error;
    if (count === 0) {
      return { ok: false, erro: "O endereço mudou enquanto localizávamos. Toque de novo." };
    }

    revalidarPainel();
    return { ok: true };
  } catch (e) {
    console.error("localizarEnderecoDeNovo:", e);
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
    if (!(await verificarRateLimit("preferenciasPainel", loja.dono_id)).permitido) {
      return { ok: false, erro: ERRO_GENERICO };
    }

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
    if (!(await verificarRateLimit("preferenciasPainel", loja.dono_id)).permitido) {
      return { ok: false, erro: ERRO_GENERICO };
    }

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
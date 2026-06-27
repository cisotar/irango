"use server";

// Server Action ADMIN (issue 092 — GREEN). Variante admin de `salvarPerfil`
// (lib/actions/loja.ts): salva perfil/endereço da loja-ALVO (`lojaId` explícito
// vindo da URL admin), via service_role, escopada por `eq("id", lojaId)`.
//
// Princípios inegociáveis aplicados:
//  - NÃO confiar no cliente (seguranca.md §10): `payload` passa por `schemaPerfil`
//    ANTES de qualquer I/O; `lojaId` validado como UUID (validarLojaIdAdmin).
//  - ALLOWLIST RN-7 (seguranca.md §2): o patch do 1º UPDATE é montado coluna a
//    coluna por `montarPatchPerfil` — colunas autoritativas (ativo, dono_id,
//    assinatura_*, hotmart_*, consentimento_*, id, latitude, longitude) JAMAIS
//    entram, mesmo num payload hostil.
//  - Fail-closed (D-4): `verificarAdminSaaS()` ANTES de qualquer efeito — fora do
//    try, propaga; sem service client, sem slugExiste, sem UPDATE se a prova falha.
//  - Coords DERIVADAS no servidor (RN-1/RN-2): geocoding best-effort no 2º UPDATE,
//    par tudo-ou-nada; geocoding falho grava par NULL sem rebaixar o salvamento.
//  - Erro interno não vaza (seguranca.md §14): detalhe no console.error; cliente
//    recebe mensagem genérica.

import type { TablesUpdate } from "@/lib/database.types";
import { slugExiste } from "@/lib/supabase/queries/lojas";
import { schemaPerfil } from "@/lib/validacoes/loja";
import {
  validarLojaIdAdmin,
  registrarAcessoAdmin,
  prepararContextoAdmin,
  revalidarLojaAdmin,
} from "@/lib/actions/admin-loja";
import {
  montarPatchPerfil,
  montarConsultaGeocoding,
} from "@/lib/actions/patches-loja";
import { geocodificarEnderecoComMotivo } from "@/lib/utils/geocodificarEndereco";

// Tipo LOCAL (não exportado): 'use server' só pode exportar funções async. O
// caller infere o retorno; este alias serve só de documentação interna.
type ResultadoPerfilAdmin =
  | { ok: true; geocodificado: boolean }
  | { ok: false; erro: string };

// Chaves do perfil aceitas (paridade com schemaPerfil). Usadas no allowlist-pick
// ANTES do parse `.strict()`, descartando colunas autoritativas do payload hostil.
const CHAVES_PERFIL = [
  "nome",
  "slug",
  "telefone",
  "whatsapp",
  "endereco_cep",
  "endereco_rua",
  "endereco_numero",
  "endereco_bairro",
  "endereco_cidade",
  "endereco_estado",
] as const;

const ERRO_GENERICO = "Não foi possível salvar. Tente novamente.";
const ERRO_VALIDACAO = "Dados inválidos. Confira os campos e tente novamente.";
const ERRO_SLUG_OCUPADO = "Este endereço (slug) já está em uso por outra loja.";

/**
 * Salva perfil/endereço da loja-alvo (`lojaId`) como admin SaaS. Recalcula coords
 * no servidor (geocoding best-effort) e escopa todo UPDATE por `eq("id", lojaId)`.
 */
export async function salvarPerfilAdmin(
  lojaId: string,
  payload: unknown,
): Promise<ResultadoPerfilAdmin> {
  const validacao = validarLojaIdAdmin(lojaId);
  if (!validacao.ok) return { ok: false, erro: ERRO_VALIDACAO };

  // Allowlist-pick ANTES do parse (1ª barreira, mesmo padrão de criarLojaAdmin):
  // só as chaves do perfil sobrevivem, então colunas autoritativas num payload
  // hostil (ativo/dono_id/assinatura_*/hotmart_*/consentimento_*/lat/long/id)
  // são DESCARTADAS — não disparam o `.strict()` do schema. `montarPatchPerfil`
  // (allowlist explícita) é a 2ª barreira no UPDATE.
  const bruto = (payload ?? {}) as Record<string, unknown>;
  const candidato = Object.fromEntries(
    CHAVES_PERFIL.filter((k) => bruto[k] !== undefined).map((k) => [k, bruto[k]]),
  );

  const parsed = schemaPerfil.safeParse(candidato);
  if (!parsed.success) return { ok: false, erro: ERRO_VALIDACAO };
  const dados = parsed.data;

  // Prova de admin ANTES de qualquer efeito (fail-closed, D-4): fora do try para
  // propagar a exceção — sem service client, sem slugExiste, sem UPDATE.
  const { svc } = await prepararContextoAdmin(validacao.lojaId);

  try {
    // Unicidade autoritativa de slug, excluindo a PRÓPRIA loja (3º arg = lojaId).
    const ocupado = await slugExiste(svc, dados.slug, validacao.lojaId);
    if (ocupado) return { ok: false, erro: ERRO_SLUG_OCUPADO };

    // 1º UPDATE: allowlist explícita (RN-7). .eq("id") obrigatório (PostgREST
    // recusa UPDATE sem WHERE, 21000), escopado pela loja-alvo.
    // montarPatchPerfil devolve só chaves da allowlist (RN-7); o cast estreita do
    // Record genérico para o tipo do row `lojas` (service client é tipado Database).
    const patch = montarPatchPerfil(dados) as TablesUpdate<"lojas">;
    const { error } = await svc
      .from("lojas")
      .update(patch)
      .eq("id", validacao.lojaId);
    if (error) throw error;

    // 2º UPDATE: par de coords derivado no servidor (RN-1/RN-2), best-effort.
    // Endereço incompleto ou geocoding falho → par NULL (tudo-ou-nada, sem
    // rebaixar o salvamento nem deixar coords órfãs).
    const consulta = montarConsultaGeocoding(dados);
    const coords =
      consulta === null
        ? null
        : (await geocodificarEnderecoComMotivo(consulta)).coords;
    const coordsPatch =
      coords === null
        ? { latitude: null, longitude: null }
        : { latitude: coords.latitude, longitude: coords.longitude };

    const { error: erroCoords } = await svc
      .from("lojas")
      .update(coordsPatch)
      .eq("id", validacao.lojaId);
    if (erroCoords) throw erroCoords;

    revalidarLojaAdmin(validacao.lojaId);
    registrarAcessoAdmin(svc, {
      lojaId: validacao.lojaId,
      acao: "salvar_perfil_loja",
    });

    return { ok: true, geocodificado: coords !== null };
  } catch (e) {
    console.error("salvarPerfilAdmin:", e);
    return { ok: false, erro: ERRO_GENERICO };
  }
}

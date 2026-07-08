"use server";

/**
 * Variantes ADMIN das formas de pagamento (incl. CHAVE PIX sensível) e do QR Pix
 * — issue 094 (crítica: SIM). Escrevem na LOJA-ALVO (`lojaId` EXPLÍCITO vindo da
 * URL admin), via service_role, escopadas pelo wrapper `escopo` (injeta
 * `eq("loja_id")` +`eq("id")` por construção). Diferente do CRUD do lojista
 * (src/lib/actions/pagamento.ts), o isolamento NÃO vem de RLS por dono — vem do
 * escopo do wrapper sob service_role, a ÚNICA amarra de isolamento entre lojas
 * (seguranca.md §2/§10/§13/§21, spec admin-onboarding-assistido.md RN-1/2/3).
 *
 * Ordem fail-closed (D-4):
 *  1. validarLojaIdAdmin(lojaId) + schema (schemaFormaPagamento/schemaPixQrUrl)
 *     ANTES de qualquer efeito;
 *  2. verificarAdminSaaS() FORA do try → exceção PROPAGA, service só depois;
 *  3. INSERT/UPDATE/DELETE via `escopo.*` (loja_id +id); `loja_id` gravado =
 *     `lojaId` da URL, injetado por último, NUNCA do payload;
 *  4. chave Pix NUNCA logada em cru (§21): o catch/console só recebe o objeto de
 *     erro do banco, jamais o payload/config com a chave.
 *  5. upload QR Pix: validarBlobImagem (magic bytes) → path SERVER-SIDE
 *     `${lojaId}/...` no bucket `pix-qr` → getPublicUrl (via `svc.storage` cru:
 *     escopo path-keyed, fora do wrapper por design).
 *
 * REGRA: arquivo 'use server' só exporta funções async — tipos locais sem export.
 */

import {
  schemaFormaPagamento,
  schemaPixQrUrl,
} from "@/lib/validacoes/pagamento";
import {
  validarLojaIdAdmin,
  registrarAcessoAdmin,
  prepararContextoAdmin,
  revalidarLojaAdmin,
  type EscopoLoja,
} from "@/lib/actions/admin-loja";
import { validarBlobImagem } from "@/lib/actions/upload-imagem";
import { CAMPO_ARQUIVO } from "@/lib/actions/upload-contrato";
import type { Json } from "@/lib/database.types";

type ResultadoPagamentoAdmin = { ok: true } | { ok: false; erro: string };

type ResultadoQrPixAdmin =
  | { ok: true; pix_qr_url: string }
  | { ok: false; erro: string };

const BUCKET_PIX_QR = "pix-qr";
const CAMPO_LOJA = "loja_id";

/**
 * Lê a config jsonb atual de uma forma da loja-alvo (escopo cross-loja do wrapper:
 * loja_id + id). Devolve um objeto plano (não-array) para servir de base ao merge;
 * o re-parse no chamador é quem valida o resultado mesclado.
 */
async function configAtualDaForma(
  escopo: EscopoLoja,
  formaId: string,
): Promise<Record<string, unknown>> {
  const { data, error } = await escopo.buscarPorId(
    "formas_pagamento",
    formaId,
    "config",
  );
  if (error) throw error;
  const config = (data as { config?: unknown } | null)?.config;
  return config != null && typeof config === "object" && !Array.isArray(config)
    ? (config as Record<string, unknown>)
    : {};
}

export async function salvarFormaPagamentoAdmin(
  lojaId: string,
  payload: unknown,
): Promise<ResultadoPagamentoAdmin> {
  const loja = validarLojaIdAdmin(lojaId);
  if (!loja.ok) return { ok: false, erro: "Loja inválida." };

  // Valida config por tipo ANTES de I/O — chave pix malformada faria o comprador
  // pagar pra ninguém. O strip do zod descarta `loja_id` injetado no payload.
  const parsed = schemaFormaPagamento.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, erro: "Forma de pagamento inválida." };
  }

  // Fail-closed: prova de admin FORA do try → propaga, service só depois.
  const { svc, escopo } = await prepararContextoAdmin(loja.lojaId);

  try {
    // loja_id = lojaId da URL, injetado por último pelo wrapper (nunca do payload).
    const { error } = await escopo.inserir("formas_pagamento", {
      tipo: parsed.data.tipo,
      config: parsed.data.config as Json,
    });
    if (error) {
      // §21: loga só o erro do banco, NUNCA o payload/config com a chave Pix.
      console.error("[salvarFormaPagamentoAdmin]", error);
      return { ok: false, erro: "Não foi possível salvar a forma de pagamento." };
    }
    registrarAcessoAdmin(svc, {
      lojaId: loja.lojaId,
      acao: "pagamento.criar",
    });
    revalidarLojaAdmin(loja.lojaId);
    return { ok: true };
  } catch {
    // §21: catch sem serializar a config/chave Pix.
    console.error("[salvarFormaPagamentoAdmin] erro inesperado");
    return { ok: false, erro: "Não foi possível salvar a forma de pagamento." };
  }
}

export async function atualizarFormaPagamentoAdmin(
  lojaId: string,
  id: string,
  payload: unknown,
): Promise<ResultadoPagamentoAdmin> {
  const loja = validarLojaIdAdmin(lojaId);
  if (!loja.ok) return { ok: false, erro: "Loja inválida." };

  const parsed = schemaFormaPagamento.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, erro: "Forma de pagamento inválida." };
  }

  const { svc, escopo } = await prepararContextoAdmin(loja.lojaId);

  try {
    // MERGE da config preserva campos gravados à parte (sobretudo `pix_qr_url`
    // do QR). Re-parse barra config inválida e descarta chaves não declaradas.
    const configAtual = await configAtualDaForma(escopo, id);
    const revalidado = schemaFormaPagamento.safeParse({
      tipo: parsed.data.tipo,
      config: { ...configAtual, ...parsed.data.config },
    });
    if (!revalidado.success) {
      console.error("[atualizarFormaPagamentoAdmin] merge inválido");
      return { ok: false, erro: "Não foi possível salvar a forma de pagamento." };
    }

    // Escopo cross-loja (loja_id + id) pelo wrapper — única amarra sob service_role.
    const { error } = await escopo.atualizar("formas_pagamento", id, {
      tipo: revalidado.data.tipo,
      config: revalidado.data.config as Json,
    });
    if (error) {
      console.error("[atualizarFormaPagamentoAdmin]", error);
      return { ok: false, erro: "Não foi possível salvar a forma de pagamento." };
    }
    registrarAcessoAdmin(svc, {
      lojaId: loja.lojaId,
      acao: "pagamento.atualizar",
      entidadeId: id,
    });
    revalidarLojaAdmin(loja.lojaId);
    return { ok: true };
  } catch {
    console.error("[atualizarFormaPagamentoAdmin] erro inesperado");
    return { ok: false, erro: "Não foi possível salvar a forma de pagamento." };
  }
}

export async function removerFormaPagamentoAdmin(
  lojaId: string,
  id: string,
): Promise<ResultadoPagamentoAdmin> {
  const loja = validarLojaIdAdmin(lojaId);
  if (!loja.ok) return { ok: false, erro: "Loja inválida." };

  const { svc, escopo } = await prepararContextoAdmin(loja.lojaId);

  try {
    // Escopo cross-loja: DELETE alcança só a forma da loja-alvo.
    const { error } = await escopo.remover("formas_pagamento", id);
    if (error) {
      console.error("[removerFormaPagamentoAdmin]", error);
      return { ok: false, erro: "Não foi possível remover a forma de pagamento." };
    }
    registrarAcessoAdmin(svc, {
      lojaId: loja.lojaId,
      acao: "pagamento.remover",
      entidadeId: id,
    });
    revalidarLojaAdmin(loja.lojaId);
    return { ok: true };
  } catch {
    console.error("[removerFormaPagamentoAdmin] erro inesperado");
    return { ok: false, erro: "Não foi possível remover a forma de pagamento." };
  }
}

export async function salvarQrPixAdmin(
  lojaId: string,
  formaId: string,
  pixQrUrl: unknown,
): Promise<ResultadoPagamentoAdmin> {
  const loja = validarLojaIdAdmin(lojaId);
  if (!loja.ok) return { ok: false, erro: "Loja inválida." };

  // URL DEVE pertencer ao Storage do iRango — rejeita URL externa antes de gravar.
  const parsed = schemaPixQrUrl.safeParse(pixQrUrl);
  if (!parsed.success) {
    return { ok: false, erro: "URL do QR deve pertencer ao Storage do iRango." };
  }

  const { svc, escopo } = await prepararContextoAdmin(loja.lojaId);

  try {
    // MERGE preserva chave/tipo_chave da forma Pix existente.
    const configAtual = await configAtualDaForma(escopo, formaId);
    const { pix_qr_url: _antigo, ...configSemQr } = configAtual;
    const configNovo =
      parsed.data === undefined
        ? configSemQr
        : { ...configSemQr, pix_qr_url: parsed.data };

    const revalidado = schemaFormaPagamento.safeParse({
      tipo: "pix",
      config: configNovo,
    });
    if (!revalidado.success) {
      console.error("[salvarQrPixAdmin] merge inválido");
      return { ok: false, erro: "Não foi possível salvar o QR Pix." };
    }

    // Escopo cross-loja: loja_id E id (forma) pelo wrapper.
    const { error } = await escopo.atualizar("formas_pagamento", formaId, {
      config: revalidado.data.config as Json,
    });
    if (error) {
      console.error("[salvarQrPixAdmin]", error);
      return { ok: false, erro: "Não foi possível salvar o QR Pix." };
    }
    registrarAcessoAdmin(svc, {
      lojaId: loja.lojaId,
      acao: "pagamento.qr_pix",
      entidadeId: formaId,
    });
    revalidarLojaAdmin(loja.lojaId);
    return { ok: true };
  } catch {
    console.error("[salvarQrPixAdmin] erro inesperado");
    return { ok: false, erro: "Não foi possível salvar o QR Pix." };
  }
}

export async function enviarQrPixAdmin(
  formData: FormData,
): Promise<ResultadoQrPixAdmin> {
  // loja_id vem do FormData mas é VALIDADO; só ele monta o path. Qualquer outro
  // campo (ex.: "pasta") é ruído ignorado.
  const loja = validarLojaIdAdmin(formData.get(CAMPO_LOJA));
  if (!loja.ok) return { ok: false, erro: "Loja inválida." };

  const value = formData.get(CAMPO_ARQUIVO);
  if (!(value instanceof Blob) || value.size <= 0) {
    return { ok: false, erro: "Imagem inválida." };
  }
  const file = value;

  // Prova de admin ANTES do trabalho de CPU/memória da validação de imagem
  // (anti-DoS) e ANTES de elevar a service_role (fail-closed, D-4). Propaga.
  // Storage é path-keyed (fora do wrapper por design) → usa `svc` cru.
  const { svc } = await prepararContextoAdmin(loja.lojaId);

  // Dupla validação server-side (metadado + magic bytes). MIME falso → rejeita
  // ANTES de qualquer upload.
  const validacao = await validarBlobImagem(file);
  if (!validacao.ok) {
    return { ok: false, erro: validacao.erro };
  }
  const { buffer, tipoReal, ext } = validacao;

  // Path SERVER-SIDE: 1º segmento = loja-alvo validada (única amarra de
  // isolamento sob service_role). file.name NUNCA entra no path.
  const path = `${loja.lojaId}/${crypto.randomUUID()}.${ext}`;

  const { error } = await svc.storage
    .from(BUCKET_PIX_QR)
    .upload(path, buffer, { contentType: tipoReal });
  if (error) {
    console.error("[enviarQrPixAdmin] falha no upload:", error);
    return { ok: false, erro: "Não foi possível enviar a imagem." };
  }

  registrarAcessoAdmin(svc, {
    lojaId: loja.lojaId,
    acao: "pagamento.qr_pix_upload",
    // path (storage) NÃO é uuid → coluna entidade_id é uuid: vai em metadados (jsonb).
    metadados: { path },
  });
  revalidarLojaAdmin(loja.lojaId);

  const { data } = svc.storage.from(BUCKET_PIX_QR).getPublicUrl(path);
  return { ok: true, pix_qr_url: data.publicUrl };
}

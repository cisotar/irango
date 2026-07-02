"use server";

// Server Actions admin (issue 091, crítica: SIM) — variantes de
// `salvarHorarios`/`salvarTema` (molde: src/lib/actions/loja.ts) que gravam o
// jsonb `horarios`/`tema` na LOJA-ALVO identificada por `lojaId` EXPLÍCITO.
//
// Princípios inegociáveis aplicados aqui:
//  - NÃO confiar no cliente (seguranca.md §10): `lojaId` validado como UUID e o
//    payload passa por safeParse (schema `.strict()`) ANTES de qualquer I/O.
//  - Fail-closed (D-4): `verificarAdminSaaS()` roda ANTES de elevar a
//    service_role. Se a prova de admin lança, a exceção PROPAGA — nunca vira
//    `{ ok:false }` amigável e o service client NUNCA é criado.
//  - RLS não protege aqui (seguranca.md §2): o UPDATE roda sob service_role
//    (BYPASSRLS), então o escopo à loja-alvo vem do wrapper `escopo.atualizarLoja`
//    (eq("id", lojaId) por construção) — sem o WHERE escopado o PostgREST recusaria.
//  - Erro interno não vaza (seguranca.md §14): detalhe vai pro console.error do
//    servidor; o cliente recebe mensagem genérica.
//
// REGRA: módulo `'use server'` só exporta funções async — nenhum type/const
// exportado (quebra o `next build`). Os retornos são tipados inline.

import {
  validarLojaIdAdmin,
  registrarAcessoAdmin,
  prepararContextoAdmin,
  revalidarLojaAdmin,
} from "@/lib/actions/admin-loja";
import { schemaHorarios, schemaTema } from "@/lib/validacoes/loja";

const ERRO_GENERICO = "Não foi possível salvar. Tente novamente.";
const ERRO_VALIDACAO = "Dados inválidos. Confira os campos e tente novamente.";
const ERRO_LOJA_INVALIDA = "Loja inválida.";

/** Grava o jsonb `horarios` na loja-alvo (`lojaId`) sob service_role. */
export async function salvarHorariosAdmin(
  lojaId: string,
  payload: unknown,
): Promise<{ ok: true } | { ok: false; erro: string }> {
  const idValido = validarLojaIdAdmin(lojaId);
  if (!idValido.ok) return { ok: false, erro: ERRO_LOJA_INVALIDA };

  const parsed = schemaHorarios.safeParse(payload);
  if (!parsed.success) return { ok: false, erro: ERRO_VALIDACAO };
  const horarios = parsed.data;

  // Fail-closed (D-4): prova admin ANTES de elevar. Se lança, PROPAGA.
  const { svc, escopo } = await prepararContextoAdmin(idValido.lojaId);

  try {
    // escopo.atualizarLoja: escopo por id à loja-alvo sob BYPASSRLS (wrapper).
    const { error } = await escopo.atualizarLoja({ horarios });
    if (error) throw error;

    revalidarLojaAdmin(idValido.lojaId);
    registrarAcessoAdmin(svc, { lojaId: idValido.lojaId, acao: "salvar_horarios" });
    return { ok: true };
  } catch (e) {
    console.error("salvarHorariosAdmin:", e);
    return { ok: false, erro: ERRO_GENERICO };
  }
}

/** Grava o jsonb `tema` na loja-alvo (`lojaId`) sob service_role. */
export async function salvarTemaAdmin(
  lojaId: string,
  payload: unknown,
): Promise<{ ok: true } | { ok: false; erro: string }> {
  const idValido = validarLojaIdAdmin(lojaId);
  if (!idValido.ok) return { ok: false, erro: ERRO_LOJA_INVALIDA };

  const parsed = schemaTema.safeParse(payload);
  if (!parsed.success) return { ok: false, erro: ERRO_VALIDACAO };
  const tema = parsed.data;

  // Fail-closed (D-4): prova admin ANTES de elevar. Se lança, PROPAGA.
  const { svc, escopo } = await prepararContextoAdmin(idValido.lojaId);

  try {
    // escopo.atualizarLoja: escopo por id à loja-alvo sob BYPASSRLS (wrapper).
    const { error } = await escopo.atualizarLoja({ tema });
    if (error) throw error;

    revalidarLojaAdmin(idValido.lojaId);
    registrarAcessoAdmin(svc, { lojaId: idValido.lojaId, acao: "salvar_tema" });
    return { ok: true };
  } catch (e) {
    console.error("salvarTemaAdmin:", e);
    return { ok: false, erro: ERRO_GENERICO };
  }
}

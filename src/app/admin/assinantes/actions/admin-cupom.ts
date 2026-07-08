"use server";

/**
 * Variantes ADMIN do CRUD de cupom — issue 134 (crítica: SIM). Escrevem na
 * LOJA-ALVO (`lojaId` explícito vindo da URL admin), via service_role, escopadas
 * pelo wrapper `escopo` (injeta `eq("loja_id", lojaId)` +`eq("id")` por
 * construção). Diferente do CRUD do lojista (src/lib/actions/cupom.ts), o
 * isolamento NÃO vem de RLS por dono — vem do escopo do wrapper e da prova de
 * admin ANTES de elevar a service_role (seguranca.md §2/§14, spec rota 5).
 *
 * Ordem fail-closed (D-4):
 *  1. validarLojaIdAdmin(lojaId) + cupomSchema.safeParse(payload) ANTES de efeito;
 *     percentual >100 / código com símbolo são reprovados pelo zod sem tocar no banco.
 *  2. prepararContextoAdmin() FORA do try → exceção de não-admin PROPAGA, service
 *     client só é criado depois da prova.
 *  3. INSERT/UPDATE/DELETE em `cupons` via `escopo.*` (loja_id +id); loja_id
 *     gravado = lojaId, NUNCA do payload (injetado por último).
 *  4. 23505 (UNIQUE loja_id+codigo) → "Este código já existe" (erroPersistenciaCupom);
 *     count === 0 no update/remove → "Cupom não encontrado." (não vaza cross-loja).
 *  5. revalidarLojaAdmin; registrarAcessoAdmin (best-effort: INSERT em admin_acessos); catch genérico.
 *
 * O valor do cupom é DEFINIÇÃO comercial persistida, não o valor cobrado: a
 * autoridade de quanto se paga permanece no checkout (criarPedido re-deriva o
 * subtotal e aplica calcularDesconto com trava de uso). Aqui só se grava a
 * definição, cujos limites são impostos por cupomSchema no servidor.
 *
 * REGRA: arquivo 'use server' só exporta funções async — tipo/mapper vêm do
 * módulo neutro cupom-erros.ts (não exportar type/const aqui).
 */

import { cupomSchema } from "@/lib/validacoes/cupom";
import {
  validarLojaIdAdmin,
  registrarAcessoAdmin,
  prepararContextoAdmin,
  revalidarLojaAdmin,
} from "@/lib/actions/admin-loja";
import {
  erroPersistenciaCupom,
  type ResultadoGestaoCupom,
} from "@/lib/actions/cupom-erros";

export async function criarCupomAdmin(
  lojaId: string,
  payload: unknown,
): Promise<ResultadoGestaoCupom> {
  const loja = validarLojaIdAdmin(lojaId);
  if (!loja.ok) return { ok: false, erro: "Loja inválida." };

  const parsed = cupomSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, erro: "Cupom inválido." };

  // Fail-closed: prova de admin FORA do try → propaga, service só depois.
  const { svc, escopo } = await prepararContextoAdmin(loja.lojaId);

  try {
    // loja_id = lojaId da URL, injetado por último pelo wrapper (nunca do payload).
    const { error } = await escopo.inserir("cupons", parsed.data);
    if (error) {
      console.error("[criarCupomAdmin]", error);
      return erroPersistenciaCupom(error);
    }
    registrarAcessoAdmin(svc, {
      lojaId: loja.lojaId,
      acao: "cupom.criar",
    });
    revalidarLojaAdmin(loja.lojaId);
    return { ok: true };
  } catch (e) {
    console.error("[criarCupomAdmin]", e);
    return { ok: false, erro: "Não foi possível salvar o cupom." };
  }
}

export async function atualizarCupomAdmin(
  lojaId: string,
  id: string,
  payload: unknown,
): Promise<ResultadoGestaoCupom> {
  const loja = validarLojaIdAdmin(lojaId);
  if (!loja.ok) return { ok: false, erro: "Loja inválida." };

  const parsed = cupomSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, erro: "Cupom inválido." };

  const { svc, escopo } = await prepararContextoAdmin(loja.lojaId);

  try {
    // Escopo cross-loja (loja_id + id) pelo wrapper; loja_id/id não vão no patch.
    const { error, count } = await escopo.atualizar("cupons", id, parsed.data);
    if (error) {
      console.error("[atualizarCupomAdmin]", error);
      return erroPersistenciaCupom(error);
    }
    // count 0 → nenhuma linha da loja-alvo com esse id (inexistente/outra loja).
    if (count === 0) return { ok: false, erro: "Cupom não encontrado." };
    registrarAcessoAdmin(svc, {
      lojaId: loja.lojaId,
      acao: "cupom.atualizar",
      entidadeId: id,
    });
    revalidarLojaAdmin(loja.lojaId);
    return { ok: true };
  } catch (e) {
    console.error("[atualizarCupomAdmin]", e);
    return { ok: false, erro: "Não foi possível salvar o cupom." };
  }
}

export async function removerCupomAdmin(
  lojaId: string,
  id: string,
): Promise<ResultadoGestaoCupom> {
  const loja = validarLojaIdAdmin(lojaId);
  if (!loja.ok) return { ok: false, erro: "Loja inválida." };

  const { svc, escopo } = await prepararContextoAdmin(loja.lojaId);

  try {
    // Escopo cross-loja: DELETE alcança só cupom da loja-alvo.
    const { error, count } = await escopo.remover("cupons", id);
    if (error) {
      console.error("[removerCupomAdmin]", error);
      return { ok: false, erro: "Não foi possível remover o cupom." };
    }
    if (count === 0) return { ok: false, erro: "Cupom não encontrado." };
    registrarAcessoAdmin(svc, {
      lojaId: loja.lojaId,
      acao: "cupom.remover",
      entidadeId: id,
    });
    revalidarLojaAdmin(loja.lojaId);
    return { ok: true };
  } catch (e) {
    console.error("[removerCupomAdmin]", e);
    return { ok: false, erro: "Não foi possível remover o cupom." };
  }
}

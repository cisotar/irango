"use server";

// Server Actions ADMIN de entrega: modalidades e zonas de entrega da loja-alvo
// (`lojaId` explícito vindo da URL admin), via service_role.
//
// Padrão fail-closed: validarLojaIdAdmin(lojaId) → zod (recusa SEM tocar
// admin/service) → prepararContextoAdmin FORA do try (prova de admin propaga,
// D-4) → escrita escopada pela loja-alvo → registrarAcessoAdmin (best-effort)
// → revalidarLojaAdmin → catch genérico.
//
// As zonas só são gravadas pela RPC `salvar_zonas_entrega` (conjunto inteiro,
// uma forma, versão otimista). Não há escrita por zona (issue 327): RLS não
// protege sob service_role, e o filtro `loja_id = p_loja_id` da RPC é a única
// amarra de isolamento entre lojas. `loja_id` é SEMPRE o parâmetro `lojaId`,
// NUNCA o do payload. Tipos auxiliares ficam locais ou vêm por `import type`
// (módulo 'use server' só exporta funções async).

import {
  validarLojaIdAdmin,
  registrarAcessoAdmin,
  prepararContextoAdmin,
  revalidarLojaAdmin,
} from "@/lib/actions/admin-loja";
import {
  MENSAGEM_CONFLITO_ZONAS,
  argsSalvarZonas,
  ehConflitoDeVersao,
  itensDasZonas,
  schemaModalidadesEntrega,
  schemaZonasEntrega,
} from "@/lib/validacoes/entrega";
import { montarPatchModalidades } from "@/lib/actions/patches-loja";
import type { ResultadoZonas } from "@/lib/actions/entrega";

type ResultadoEntregaAdmin = { ok: true } | { ok: false; erro: string };

const ERRO_GENERICO = "Não foi possível concluir a operação.";

/**
 * Par admin de `salvarModalidadesEntrega` (spec modalidades-entrega-loja,
 * paridade hub ↔ painel). Mesma ordem fail-closed das demais: lojaId validado
 * → zod (as duas desligadas / modo fora do enum recusados SEM elevar) → prova
 * de admin FORA do try (propaga) → `escopo.atualizarLoja` (`eq("id", lojaId)`)
 * com o patch da MESMA allowlist do painel. `atualizarLoja` só filtra billing,
 * dono e id: é a allowlist que impede `ativo` de passar.
 */
export async function salvarModalidadesEntregaAdmin(
  lojaId: string,
  payload: unknown,
): Promise<ResultadoEntregaAdmin> {
  const loja = validarLojaIdAdmin(lojaId);
  if (!loja.ok) return { ok: false, erro: "Loja inválida." };

  const parsed = schemaModalidadesEntrega.safeParse(payload);
  if (!parsed.success) {
    const regra = parsed.error.issues.find((i) => i.code === "custom");
    return { ok: false, erro: regra?.message ?? "Dados inválidos." };
  }

  const { svc, escopo } = await prepararContextoAdmin(loja.lojaId);

  try {
    const { error } = await escopo.atualizarLoja(montarPatchModalidades(parsed.data));
    if (error) {
      console.error("[salvarModalidadesEntregaAdmin]", error);
      return { ok: false, erro: ERRO_GENERICO };
    }

    registrarAcessoAdmin(svc, {
      lojaId: loja.lojaId,
      acao: "salvar_modalidades_entrega",
      metadados: { ...parsed.data },
    });
    revalidarLojaAdmin(loja.lojaId);
    return { ok: true };
  } catch (e) {
    console.error("[salvarModalidadesEntregaAdmin]", e);
    return { ok: false, erro: ERRO_GENERICO };
  }
}

/**
 * Par admin de `salvarZonasEntrega` (issues 325/328). Ordem fail-closed D-4:
 * lojaId validado → zod (`.strict()`, recusado SEM elevar) → prova de admin
 * FORA do try (propaga) → UMA RPC `salvar_zonas_entrega` com `p_loja_id`
 * LITERAL do lojaId validado. Sob service_role não há RLS: o escopo é o filtro
 * `loja_id = p_loja_id` dentro da RPC, e a versão vale também para o admin
 * (não atropela uma gravação do lojista). Conflito não registra acesso.
 */
export async function salvarZonasEntregaAdmin(
  lojaId: string,
  payload: unknown,
): Promise<ResultadoZonas> {
  const loja = validarLojaIdAdmin(lojaId);
  if (!loja.ok) return { ok: false, erro: "Loja inválida." };

  const parsed = schemaZonasEntrega.safeParse(payload);
  if (!parsed.success) {
    const regra = parsed.error.issues.find((i) => i.code === "custom");
    return { ok: false, erro: regra?.message ?? "Dados inválidos." };
  }

  const { svc } = await prepararContextoAdmin(loja.lojaId);

  try {
    const { data, error } = await svc.rpc("salvar_zonas_entrega", {
      p_loja_id: loja.lojaId,
      ...argsSalvarZonas(parsed.data),
    });
    if (ehConflitoDeVersao(error)) {
      console.warn("[salvarZonasEntregaAdmin] conflito de versão");
      return { ok: false, conflito: true, erro: MENSAGEM_CONFLITO_ZONAS };
    }
    if (error || !Number.isSafeInteger(data)) {
      console.error("[salvarZonasEntregaAdmin]", error ?? "versão inválida devolvida pela RPC");
      return { ok: false, erro: ERRO_GENERICO };
    }

    registrarAcessoAdmin(svc, {
      lojaId: loja.lojaId,
      acao: "salvar_zonas_entrega",
      metadados: { forma: parsed.data.forma, itens: itensDasZonas(parsed.data) },
    });
    revalidarLojaAdmin(loja.lojaId);
    return { ok: true, versao: data };
  } catch (e) {
    console.error("[salvarZonasEntregaAdmin]", e);
    return { ok: false, erro: ERRO_GENERICO };
  }
}

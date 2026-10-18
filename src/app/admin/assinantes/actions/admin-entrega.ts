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
// uma forma, versão otimista) e NÃO ativam a forma; a forma ativa só muda pela
// RPC `definir_forma_frete` (botão "Usar esta forma", issue 325). Não há
// escrita por zona (issue 327): RLS não protege sob service_role, e o filtro
// `loja_id = p_loja_id` das RPCs é a única amarra de isolamento entre lojas. `loja_id` é SEMPRE o parâmetro `lojaId`,
// NUNCA o do payload. Tipos auxiliares ficam locais ou vêm por `import type`
// (módulo 'use server' só exporta funções async).

import {
  validarLojaIdAdmin,
  registrarAcessoAdmin,
  prepararContextoAdmin,
  revalidarLojaAdmin,
} from "@/lib/actions/admin-loja";
import {
  MENSAGEM_ERRO_FORMA_FRETE,
  MENSAGEM_ERRO_ZONAS,
  argsSalvarZonas,
  itensDasZonas,
  resultadoDaRpcFormaFrete,
  resultadoDaRpcZonas,
  schemaDefinirFormaFrete,
  schemaModalidadesEntrega,
  validarPayloadZonas,
  type ResultadoZonas,
} from "@/lib/validacoes/entrega";
import { montarPatchModalidades } from "@/lib/actions/patches-loja";

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
 * (não atropela uma gravação do lojista). Conflito não registra acesso. Gravar
 * NÃO ativa a forma: isso é `definirFormaFreteAdmin`.
 */
export async function salvarZonasEntregaAdmin(
  lojaId: string,
  payload: unknown,
): Promise<ResultadoZonas> {
  const loja = validarLojaIdAdmin(lojaId);
  if (!loja.ok) return { ok: false, erro: "Loja inválida." };

  const validado = validarPayloadZonas(payload);
  if (!validado.ok) return validado;

  const { svc } = await prepararContextoAdmin(loja.lojaId);

  try {
    // Tenant por ÚLTIMO: nenhum spread sobrescreve o lojaId validado da URL.
    const resposta = await svc.rpc("salvar_zonas_entrega", {
      ...argsSalvarZonas(validado.data),
      p_loja_id: loja.lojaId,
    });
    const resultado = resultadoDaRpcZonas("salvarZonasEntregaAdmin", resposta);
    if (!resultado.ok) return resultado;

    registrarAcessoAdmin(svc, {
      lojaId: loja.lojaId,
      acao: "salvar_zonas_entrega",
      metadados: { forma: validado.data.forma, itens: itensDasZonas(validado.data) },
    });
    revalidarLojaAdmin(loja.lojaId);
    return resultado;
  } catch (e) {
    console.error("[salvarZonasEntregaAdmin]", e);
    return { ok: false, erro: MENSAGEM_ERRO_ZONAS };
  }
}

/**
 * Par admin de `definirFormaFrete` (issue 325): ativa a forma de frete da
 * loja-alvo. Mesma ordem fail-closed: lojaId validado → zod (`.strict()`,
 * recusado SEM elevar) → prova de admin FORA do try (propaga) → UMA RPC
 * `definir_forma_frete` com `p_loja_id` LITERAL do lojaId validado (versão
 * otimista e recusa de forma sem zona valem também para o admin). Auditoria e
 * revalidate só no ok.
 */
export async function definirFormaFreteAdmin(
  lojaId: string,
  payload: unknown,
): Promise<ResultadoZonas> {
  const loja = validarLojaIdAdmin(lojaId);
  if (!loja.ok) return { ok: false, erro: "Loja inválida." };

  const parsed = schemaDefinirFormaFrete.safeParse(payload);
  if (!parsed.success) return { ok: false, erro: MENSAGEM_ERRO_FORMA_FRETE };

  const { svc } = await prepararContextoAdmin(loja.lojaId);

  try {
    // Tenant por ÚLTIMO: nada sobrescreve o lojaId validado da URL.
    const resposta = await svc.rpc("definir_forma_frete", {
      p_forma: parsed.data.forma,
      p_versao: parsed.data.versao,
      p_loja_id: loja.lojaId,
    });
    const resultado = resultadoDaRpcFormaFrete("definirFormaFreteAdmin", resposta);
    if (!resultado.ok) return resultado;

    registrarAcessoAdmin(svc, {
      lojaId: loja.lojaId,
      acao: "definir_forma_frete",
      metadados: { forma: parsed.data.forma },
    });
    revalidarLojaAdmin(loja.lojaId);
    return resultado;
  } catch (e) {
    console.error("[definirFormaFreteAdmin]", e);
    return { ok: false, erro: MENSAGEM_ERRO_FORMA_FRETE };
  }
}

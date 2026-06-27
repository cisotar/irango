"use server";

// GREEN (issue 093, crítica: SIM) — Server Actions ADMIN do CRUD de ZONAS de
// entrega (zona + taxa 1:1 + bairros 1:N). Escrevem na loja-alvo (`lojaId`
// explícito vindo da URL admin), via service_role, SEMPRE escopadas por
// eq("loja_id", lojaId) (+ eq("id", id) em update/delete). RLS NÃO protege sob
// service_role: o escopo manual é a única amarra de isolamento entre lojas.
//
// Padrão fail-closed espelhando o contrato de admin-entrega.test.ts:
//   validarLojaIdAdmin(lojaId) → schemaZonaCompleta.safeParse (taxa negativa
//   reprovada SEM tocar admin/service/insert, RN-6) → verificarAdminSaaS() FORA
//   do try (propaga, D-4) → createServiceClient() → [em update/remove] CHECAGEM
//   DE PROPRIEDADE: SELECT zonas_entrega eq("id", id)+eq("loja_id", lojaId)
//   ANTES de escrever em taxas_entrega/bairros_zona (zona alheia → bloqueia,
//   zero escrita em filho) → UPDATE/DELETE/INSERT escopado → revalidatePath
//   (admin + vitrine) → registrarAcessoAdmin (no-op) → catch genérico.
//
// `loja_id` gravado é SEMPRE o parâmetro `lojaId`, NUNCA o do payload (que pode
// ser hostil). Tipos auxiliares ficam locais (módulo 'use server' só exporta
// funções async).

import {
  validarLojaIdAdmin,
  registrarAcessoAdmin,
  prepararContextoAdmin,
  revalidarLojaAdmin,
} from "@/lib/actions/admin-loja";
import { schemaZonaCompleta } from "@/lib/validacoes/entrega";

type ResultadoEntregaAdmin = { ok: true } | { ok: false; erro: string };

const ERRO_GENERICO = "Não foi possível concluir a operação.";

export async function criarZonaAdmin(
  lojaId: string,
  payload: unknown,
): Promise<ResultadoEntregaAdmin> {
  const loja = validarLojaIdAdmin(lojaId);
  if (!loja.ok) return { ok: false, erro: "Loja inválida." };

  // Autoridade do servidor (RN-6): taxa negativa é reprovada aqui, ANTES de
  // tocar admin/service/insert.
  const parsed = schemaZonaCompleta.safeParse(payload);
  if (!parsed.success) return { ok: false, erro: "Dados inválidos." };

  // Fora do try: se a prova de admin falha, PROPAGA (fail-closed, D-4) e o
  // service client nunca é criado.
  const { svc } = await prepararContextoAdmin(loja.lojaId);

  try {
    const { data: zona, error: erroZona } = await svc
      .from("zonas_entrega")
      .insert({
        // loja_id autoritativo = parâmetro, NUNCA o payload.
        loja_id: loja.lojaId,
        nome: parsed.data.nome,
        tipo: parsed.data.tipo,
        ativo: parsed.data.ativo,
      })
      .select("id")
      .single();
    if (erroZona || zona == null) return { ok: false, erro: ERRO_GENERICO };

    const { error: erroTaxa } = await svc
      .from("taxas_entrega")
      .insert({ ...parsed.data.taxa, zona_id: zona.id });
    if (erroTaxa) return { ok: false, erro: ERRO_GENERICO };

    if (parsed.data.bairros.length > 0) {
      const { error: erroBairros } = await svc
        .from("bairros_zona")
        .insert(
          parsed.data.bairros.map((nome) => ({ nome, zona_id: zona.id })),
        );
      if (erroBairros) return { ok: false, erro: ERRO_GENERICO };
    }

    registrarAcessoAdmin(svc, {
      lojaId: loja.lojaId,
      acao: "criar_zona",
      entidadeId: zona.id,
    });
    revalidarLojaAdmin(loja.lojaId);
    return { ok: true };
  } catch (e) {
    console.error("[criarZonaAdmin]", e);
    return { ok: false, erro: ERRO_GENERICO };
  }
}

export async function atualizarZonaAdmin(
  lojaId: string,
  id: string,
  payload: unknown,
): Promise<ResultadoEntregaAdmin> {
  const loja = validarLojaIdAdmin(lojaId);
  if (!loja.ok) return { ok: false, erro: "Loja inválida." };

  const parsed = schemaZonaCompleta.safeParse(payload);
  if (!parsed.success) return { ok: false, erro: "Dados inválidos." };

  const { svc } = await prepararContextoAdmin(loja.lojaId);

  try {
    // CHECAGEM DE PROPRIEDADE (central): a zona pertence à loja-alvo? Consulta
    // escopada por id + loja_id ANTES de escrever em taxas_entrega/bairros_zona.
    // Zona alheia (null) → bloqueia, zero escrita em filho.
    const { data: zona, error: erroPosse } = await svc
      .from("zonas_entrega")
      .select("id")
      .eq("id", id)
      .eq("loja_id", loja.lojaId)
      .maybeSingle();
    if (erroPosse) return { ok: false, erro: ERRO_GENERICO };
    if (zona == null) return { ok: false, erro: "Zona não encontrada." };

    // UPDATE da zona escopado por id + loja-alvo (cross-loja inalcançável).
    const { error: erroZona } = await svc
      .from("zonas_entrega")
      .update({
        nome: parsed.data.nome,
        tipo: parsed.data.tipo,
        ativo: parsed.data.ativo,
      })
      .eq("id", id)
      .eq("loja_id", loja.lojaId);
    if (erroZona) return { ok: false, erro: ERRO_GENERICO };

    // Taxa 1:1 por zona_id (upsert).
    const { error: erroTaxa } = await svc
      .from("taxas_entrega")
      .upsert({ ...parsed.data.taxa, zona_id: id }, { onConflict: "zona_id" });
    if (erroTaxa) return { ok: false, erro: ERRO_GENERICO };

    // Bairros: substitui o conjunto (delete + insert) sob a zona já confirmada.
    const { error: erroDel } = await svc
      .from("bairros_zona")
      .delete()
      .eq("zona_id", id);
    if (erroDel) return { ok: false, erro: ERRO_GENERICO };

    if (parsed.data.bairros.length > 0) {
      const { error: erroIns } = await svc
        .from("bairros_zona")
        .insert(parsed.data.bairros.map((nome) => ({ nome, zona_id: id })));
      if (erroIns) return { ok: false, erro: ERRO_GENERICO };
    }

    registrarAcessoAdmin(svc, {
      lojaId: loja.lojaId,
      acao: "atualizar_zona",
      entidadeId: id,
    });
    revalidarLojaAdmin(loja.lojaId);
    return { ok: true };
  } catch (e) {
    console.error("[atualizarZonaAdmin]", e);
    return { ok: false, erro: ERRO_GENERICO };
  }
}

export async function removerZonaAdmin(
  lojaId: string,
  id: string,
): Promise<ResultadoEntregaAdmin> {
  const loja = validarLojaIdAdmin(lojaId);
  if (!loja.ok) return { ok: false, erro: "Loja inválida." };

  const { svc } = await prepararContextoAdmin(loja.lojaId);

  try {
    // DELETE escopado por id + loja-alvo: zona de outra loja não é afetada.
    // Taxa/bairros caem por cascata de FK.
    const { error } = await svc
      .from("zonas_entrega")
      .delete()
      .eq("id", id)
      .eq("loja_id", loja.lojaId);
    if (error) return { ok: false, erro: ERRO_GENERICO };

    registrarAcessoAdmin(svc, {
      lojaId: loja.lojaId,
      acao: "remover_zona",
      entidadeId: id,
    });
    revalidarLojaAdmin(loja.lojaId);
    return { ok: true };
  } catch (e) {
    console.error("[removerZonaAdmin]", e);
    return { ok: false, erro: ERRO_GENERICO };
  }
}

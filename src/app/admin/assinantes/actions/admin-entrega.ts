"use server";

// GREEN (issue 093, crítica: SIM) — Server Actions ADMIN do CRUD de ZONAS de
// entrega (zona + taxa 1:1 + bairros 1:N). Escrevem na loja-alvo (`lojaId`
// explícito vindo da URL admin), via service_role. A ZONA (tem `loja_id`) é
// escrita/lida pelo wrapper `escopo.*` (injeta eq("loja_id")+eq("id") por
// construção); as tabelas-FILHO `taxas_entrega`/`bairros_zona` (escopadas por
// `zona_id`, sem coluna `loja_id`) ficam no `svc` cru, ancoradas na zona cuja
// posse já foi provada. RLS NÃO protege sob service_role: esse escopo é a única
// amarra de isolamento entre lojas.
//
// Padrão fail-closed espelhando o contrato de admin-entrega.test.ts:
//   validarLojaIdAdmin(lojaId) → schemaZonaCompleta.safeParse (taxa negativa
//   reprovada SEM tocar admin/service/insert, RN-6) → verificarAdminSaaS() FORA
//   do try (propaga, D-4) → createServiceClient() → [em update/remove] CHECAGEM
//   DE PROPRIEDADE: escopo.buscarPorId("zonas_entrega", id) ANTES de escrever em
//   taxas_entrega/bairros_zona (zona alheia → bloqueia, zero escrita em filho) →
//   escopo.atualizar/remover + inserts-filho por zona_id → revalidatePath
//   (admin + vitrine) → registrarAcessoAdmin (no-op) → catch genérico.
//
// `loja_id` gravado é SEMPRE o parâmetro `lojaId` (injetado por último pelo
// wrapper), NUNCA o do payload (que pode ser hostil). Tipos auxiliares ficam
// locais (módulo 'use server' só exporta funções async).

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
  const { svc, escopo } = await prepararContextoAdmin(loja.lojaId);

  try {
    // Zona pelo wrapper: loja_id injetado por último (autoritativo, nunca payload).
    const { data, error: erroZona } = await escopo
      .inserir("zonas_entrega", {
        nome: parsed.data.nome,
        tipo: parsed.data.tipo,
        ativo: parsed.data.ativo,
      })
      .select("id")
      .maybeSingle();
    const zona = data as { id: string } | null;
    if (erroZona || zona == null) return { ok: false, erro: ERRO_GENERICO };

    // Filhas por zona_id (sem loja_id) → svc cru, ancoradas na zona recém-criada.
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

  const { svc, escopo } = await prepararContextoAdmin(loja.lojaId);

  try {
    // CHECAGEM DE PROPRIEDADE (central): a zona pertence à loja-alvo? Consulta
    // escopada pelo wrapper (loja_id + id) ANTES de escrever nas filhas.
    // Zona alheia (null) → bloqueia, zero escrita em filho.
    const { data: zona, error: erroPosse } = await escopo.buscarPorId(
      "zonas_entrega",
      id,
      "id",
    );
    if (erroPosse) return { ok: false, erro: ERRO_GENERICO };
    if (zona == null) return { ok: false, erro: "Zona não encontrada." };

    // UPDATE da zona escopado pelo wrapper (loja_id + id) — cross-loja inalcançável.
    const { error: erroZona } = await escopo.atualizar("zonas_entrega", id, {
      nome: parsed.data.nome,
      tipo: parsed.data.tipo,
      ativo: parsed.data.ativo,
    });
    if (erroZona) return { ok: false, erro: ERRO_GENERICO };

    // Taxa 1:1 por zona_id (upsert) — filha, svc cru sob a zona já confirmada.
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

  const { svc, escopo } = await prepararContextoAdmin(loja.lojaId);

  try {
    // DELETE escopado pelo wrapper (loja_id + id): zona de outra loja não é
    // afetada. Taxa/bairros caem por cascata de FK.
    const { error } = await escopo.remover("zonas_entrega", id);
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

"use server";

import { revalidatePath } from "next/cache";
import { verificarAdminSaaS } from "@/lib/auth/admin";
import { createServiceClient } from "@/lib/supabase/service";
import { lojaIdSchema, registrarAcessoAdmin } from "@/lib/actions/admin-loja";
import { particionarCaminhos } from "@/lib/actions/galeria-contrato";
import {
  aplicarStatusAdmin,
  excluirLojaPermanente,
} from "@/lib/supabase/queries/adminAssinatura";
import {
  criarLoja,
  resolverDonoPorEmail,
  slugExiste,
} from "@/lib/supabase/queries/lojas";
import { buscarPapeisDoUsuario } from "@/lib/supabase/queries/papeis";
import { schemaNovaLojaAdmin } from "@/lib/validacoes/loja";
import { VERSAO_TERMOS } from "@/lib/constants/termos";

/**
 * ÚNICA via não-webhook autorizada a escrever `assinatura_status` (RN-12/13/14).
 * Toda action: (1) valida `lojaId` (UUID) server-side; (2) `verificarAdminSaaS()`
 * ANTES de qualquer efeito — falha de admin propaga (D-4, nunca vira `{ ok:false }`
 * amigável); (3) eleva para service_role só depois da prova; (4) revalida a rota.
 * O cliente envia APENAS `lojaId` — status/datas são constantes literais por
 * action, decididas server-side (Recálculo no Servidor).
 */

type Resultado = { ok: true } | { ok: false; erro: string };

type ResultadoCriarLoja =
  | { ok: true; lojaId: string }
  | { ok: false; erro: string };

/**
 * Cria uma loja em nome de um lojista (admin SaaS — onboarding assistido, issue
 * 087). NÃO confia no cliente: recebe só `email`/`nome`/`slug` (`.strict()` barra
 * `ativo`/`assinatura_status`/`dono_id` hostis); `dono_id` é RESOLVIDO server-side
 * por e-mail; `ativo=false`, `assinatura_status='trial'` e o consentimento são
 * constantes do servidor (espelham `auth.ts`/`garantirLojaDoDono`).
 *
 * Ordem (fail-closed, D-4): `safeParse` → `verificarAdminSaaS()` ANTES de qualquer
 * efeito e FORA do try (a exceção PROPAGA, nunca vira `{ ok:false }`) → eleva a
 * service_role → resolve dono → checa slug → INSERT. Violação do índice único
 * `lojas(dono_id)` (23505, RN-4) é capturada como `{ ok:false }`, sem retry.
 */
export async function criarLojaAdmin(
  payload: unknown,
): Promise<ResultadoCriarLoja> {
  // Allowlist ANTES do parse: só `email`/`nome`/`slug` chegam ao schema. Chaves
  // autoritativas hostis no payload (`ativo`, `assinatura_status`, `dono_id`) são
  // descartadas aqui — nunca influenciam o INSERT (Recálculo no Servidor, §10).
  const bruto = (payload ?? {}) as Record<string, unknown>;
  const parsed = schemaNovaLojaAdmin.safeParse({
    email: bruto.email,
    nome: bruto.nome,
    slug: bruto.slug,
  });
  if (!parsed.success) {
    return { ok: false, erro: "Dados inválidos." };
  }
  const { email, nome, slug } = parsed.data;

  // Prova de admin ANTES de qualquer efeito e FORA do try: falha PROPAGA
  // (fail-closed, D-4) e o service client nunca é criado.
  await verificarAdminSaaS();
  const svc = createServiceClient();
  let donoIdResolvido: string | null = null;

  try {
    // `dono_id` autoritativo: resolvido por e-mail server-side, nunca do payload.
    const donoId = await resolverDonoPorEmail(svc, email);
    donoIdResolvido = donoId;
    if (donoId === null) {
      return { ok: false, erro: "Nenhuma conta encontrada para este e-mail." };
    }

    if (await slugExiste(svc, slug)) {
      return { ok: false, erro: "Este endereço (slug) já está em uso." };
    }

    // Defaults de cadastro decididos pelo SERVIDOR (espelham auth.ts).
    const loja = await criarLoja(svc, {
      dono_id: donoId,
      nome,
      slug,
      ativo: false,
      assinatura_status: "trial",
      consentimento_em: new Date().toISOString(),
      consentimento_versao: VERSAO_TERMOS,
    });

    registrarAcessoAdmin(svc, { lojaId: loja.id, acao: "criar_loja" });
    revalidatePath(ROTA_ASSINANTES);
    return { ok: true, lojaId: loja.id };
  } catch (e) {
    // RN-4: índice único lojas(dono_id) → dono já tem loja. Sem retry, sem
    // revalidate. Mensagem neutra; e-mail nunca logado em cru (§14/§21).
    console.error("[criarLojaAdmin]", e);
    // L1 = A (issue 337): a barreira é o trigger `lojas_exige_dono_lojista`;
    // os papéis (service_role) só escolhem a mensagem depois da recusa.
    if (await ehContaSoCliente(svc, donoIdResolvido)) {
      return { ok: false, erro: MSG_CONTA_CLIENTE };
    }
    return { ok: false, erro: "Não foi possível criar a loja." };
  }
}

const MSG_CONTA_CLIENTE =
  "Este e-mail pertence a uma conta de cliente e não pode ser dono de loja.";

/** Conta com papel `cliente` e sem `lojista`. Falha de leitura → false (mensagem neutra). */
async function ehContaSoCliente(
  svc: ReturnType<typeof createServiceClient>,
  donoId: string | null,
): Promise<boolean> {
  if (!donoId) return false;
  try {
    const papeis = await buscarPapeisDoUsuario(svc, donoId);
    return papeis.includes("cliente") && !papeis.includes("lojista");
  } catch (e) {
    console.error("[criarLojaAdmin] papeis", e);
    return false;
  }
}

// `lojaIdSchema` centralizado em `@/lib/actions/admin-loja` (reuso entre as actions
// de billing e as de onboarding assistido) — z.guid(), alinhado com frete.ts/schemaCheckout.

const ROTA_ASSINANTES = "/admin/assinantes";

function lojaNaoEncontrada(): Resultado {
  return { ok: false, erro: "Loja não encontrada." };
}

/** Concede cortesia: acesso pleno sem cobrança. billing_provider/plano_id = NULL (RN-12). */
export async function concederCortesia(lojaId: string): Promise<Resultado> {
  const parsed = lojaIdSchema.safeParse(lojaId);
  if (!parsed.success) return { ok: false, erro: "Loja inválida." };
  await verificarAdminSaaS();
  const svc = createServiceClient();
  try {
    const { linhasAfetadas } = await aplicarStatusAdmin(
      svc,
      parsed.data,
      "cortesia",
      null,
    );
    if (linhasAfetadas === 0) return lojaNaoEncontrada();
    await desvincularBilling(svc, parsed.data);
    revalidatePath(ROTA_ASSINANTES);
    return { ok: true };
  } catch (e) {
    console.error("[concederCortesia]", e);
    return { ok: false, erro: "Não foi possível concluir a ação." };
  }
}

/** Revoga cortesia: corte imediato (cancelada, fim_periodo=now()). */
export async function revogarCortesia(lojaId: string): Promise<Resultado> {
  const parsed = lojaIdSchema.safeParse(lojaId);
  if (!parsed.success) return { ok: false, erro: "Loja inválida." };
  await verificarAdminSaaS();
  const svc = createServiceClient();
  try {
    const { linhasAfetadas } = await aplicarStatusAdmin(
      svc,
      parsed.data,
      "cancelada",
      new Date(),
    );
    if (linhasAfetadas === 0) return lojaNaoEncontrada();
    revalidatePath(ROTA_ASSINANTES);
    return { ok: true };
  } catch (e) {
    console.error("[revogarCortesia]", e);
    return { ok: false, erro: "Não foi possível concluir a ação." };
  }
}

/** Suspende a loja: corte imediato (suspensa, fim_periodo=now()), sem carência. */
export async function suspenderLoja(lojaId: string): Promise<Resultado> {
  const parsed = lojaIdSchema.safeParse(lojaId);
  if (!parsed.success) return { ok: false, erro: "Loja inválida." };
  await verificarAdminSaaS();
  const svc = createServiceClient();
  try {
    const { linhasAfetadas } = await aplicarStatusAdmin(
      svc,
      parsed.data,
      "suspensa",
      new Date(),
    );
    if (linhasAfetadas === 0) return lojaNaoEncontrada();
    revalidatePath(ROTA_ASSINANTES);
    return { ok: true };
  } catch (e) {
    console.error("[suspenderLoja]", e);
    return { ok: false, erro: "Não foi possível concluir a ação." };
  }
}

/** Reativa a loja: override explícito para `ativa` (não toca fim_periodo). */
export async function reativarLoja(lojaId: string): Promise<Resultado> {
  const parsed = lojaIdSchema.safeParse(lojaId);
  if (!parsed.success) return { ok: false, erro: "Loja inválida." };
  await verificarAdminSaaS();
  const svc = createServiceClient();
  try {
    const { linhasAfetadas } = await aplicarStatusAdmin(
      svc,
      parsed.data,
      "ativa",
      undefined,
    );
    if (linhasAfetadas === 0) return lojaNaoEncontrada();
    revalidatePath(ROTA_ASSINANTES);
    return { ok: true };
  } catch (e) {
    console.error("[reativarLoja]", e);
    return { ok: false, erro: "Não foi possível concluir a ação." };
  }
}

/**
 * Hard delete irreversível de loja (issue 084). Recebe APENAS `lojaId`. Ordem
 * obrigatória (spec admin-hard-delete-loja.md): valida UUID → prova de admin
 * (FORA do try; propaga, fail-closed) → service_role → limpeza best-effort de
 * storage → DELETE com cascade → revalida. A "palavra de confirmação" da UI
 * (RN-2/RN-3) NÃO trafega: o servidor não a recebe nem revalida.
 */
export async function excluirLoja(lojaId: string): Promise<Resultado> {
  const parsed = lojaIdSchema.safeParse(lojaId);
  if (!parsed.success) return { ok: false, erro: "Loja inválida." };
  await verificarAdminSaaS();
  const svc = createServiceClient();
  try {
    await limparStorageDaLoja(svc, parsed.data);
    const { linhasAfetadas } = await excluirLojaPermanente(svc, parsed.data);
    if (linhasAfetadas === 0) return lojaNaoEncontrada();
    revalidatePath(ROTA_ASSINANTES);
    return { ok: true };
  } catch (e) {
    console.error("[excluirLoja]", e);
    return { ok: false, erro: "Não foi possível concluir a ação." };
  }
}

/** Máximo de caminhos por `storage.remove` (a API trabalha em lotes de 100). */
const BLOCO_REMOCAO_STORAGE = 100;

/**
 * Limpeza best-effort do storage da loja (issue 084). NUNCA aborta o DELETE:
 * qualquer falha é logada e engolida (objetos órfãos são aceitos). Buckets:
 *   - `produtos`, registrados: `caminho` + `miniatura_caminho` de `imagens_loja`
 *     DA LOJA, lidos ANTES do DELETE (a tabela cai em cascata com a loja) —
 *     cobre a pasta `galeria/` e passa do limite de 100 do `list()` (RN-G15);
 *   - `pix-qr`: plano → `list(lojaId)`;
 *   - `produtos`, complemento: raiz `${lojaId}/` E `${lojaId}/logo/` listadas,
 *     para objetos que não estejam registrados.
 * Todo caminho passa pela trava de prefixo `${lojaId}/` (sob service_role é a
 * única amarra no Storage) e sai em blocos de até 100 por `remove`.
 */
async function limparStorageDaLoja(
  svc: ReturnType<typeof createServiceClient>,
  lojaId: string,
): Promise<void> {
  const registrados = await caminhosRegistradosDaLoja(svc, lojaId);

  const buckets: { bucket: string; prefixos: string[]; extras: string[] }[] = [
    { bucket: "pix-qr", prefixos: [lojaId], extras: [] },
    { bucket: "produtos", prefixos: [lojaId, `${lojaId}/logo`], extras: registrados },
  ];
  for (const { bucket, prefixos, extras } of buckets) {
    const paths = new Set<string>(extras);
    for (const prefixo of prefixos) {
      try {
        const { data, error } = await svc.storage.from(bucket).list(prefixo);
        if (error) throw error;
        for (const item of data ?? []) paths.add(`${prefixo}/${item.name}`);
      } catch (e) {
        console.error("[excluirLoja] storage list", { bucket, prefixo }, e);
      }
    }
    const { daLoja, alheios } = particionarCaminhos([...paths], lojaId);
    if (alheios.length > 0) {
      console.error("[excluirLoja] caminhos fora da loja descartados", { bucket, alheios });
    }
    for (let i = 0; i < daLoja.length; i += BLOCO_REMOCAO_STORAGE) {
      try {
        const { error } = await svc.storage
          .from(bucket)
          .remove(daLoja.slice(i, i + BLOCO_REMOCAO_STORAGE));
        if (error) throw error;
      } catch (e) {
        console.error("[excluirLoja] storage remove", { bucket }, e);
      }
    }
  }
}

/** Caminhos de imagem registrados da loja (best-effort: falha → lista vazia). */
async function caminhosRegistradosDaLoja(
  svc: ReturnType<typeof createServiceClient>,
  lojaId: string,
): Promise<string[]> {
  try {
    const { data, error } = await svc
      .from("imagens_loja")
      .select("caminho, miniatura_caminho")
      .eq("loja_id", lojaId);
    if (error) throw error;
    return (data ?? []).flatMap((l) =>
      l.miniatura_caminho ? [l.caminho, l.miniatura_caminho] : [l.caminho],
    );
  } catch (e) {
    console.error("[excluirLoja] leitura de imagens_loja", e);
    return [];
  }
}

// `billing_provider` e `plano_id` são colunas reais (migrations 073/074), mas o
// `database.types.ts` ainda não foi regenerado (DB local desligado nesta máquina).
// Tipamos o patch com a forma pós-073 — sem `any` — em vez de aguardar a regen.
type DesvinculoBilling = {
  billing_provider: null;
  plano_id: null;
};

async function desvincularBilling(
  svc: ReturnType<typeof createServiceClient>,
  lojaId: string,
): Promise<void> {
  // Cast localizado e tipado (não `any`): a coluna existe no banco; o tipo gerado
  // é que está defasado. Quando 073 regenerar os tipos, o cast pode sair.
  const patch = { billing_provider: null, plano_id: null } satisfies DesvinculoBilling;
  const { error } = await (svc.from("lojas") as unknown as {
    update: (p: DesvinculoBilling) => {
      eq: (c: string, v: string) => Promise<{ error: unknown }>;
    };
  })
    .update(patch)
    .eq("id", lojaId);
  if (error) throw error;
}

"use server";

// Server Actions ADMIN de logo (issue 116). Variante admin de salvar/remover a
// logo da loja-ALVO (`lojaId` da URL) sob service_role, escopada por tenant —
// núcleo de autorização do fix cross-tenant (specs/fix-logo-admin-cross-tenant.md).
//
// Difere de `salvarLogoLoja`/`removerLogoLoja` do LOJISTA (lib/actions/logo.ts):
// lá a loja é DERIVADA do auth (buscarLojaDoDono) e a escrita corre sob RLS; aqui
// o admin NÃO é dono da loja-alvo — a escrita corre sob service_role (que BYPASSA
// a RLS), então a defesa NÃO é RLS. O gate é (seguranca.md §7 "Padrão admin"):
//   - `validarLojaIdAdmin` ANTES de qualquer efeito (não-UUID/ausente → { ok:false },
//     zero upload, sem elevar a service_role — anti-DoS);
//   - `prepararContextoAdmin(lojaId)` FORA do try — `verificarAdminSaaS()` prova
//     admin ANTES de validar a imagem (CPU/memória) e ANTES de criar o service
//     client; se lança, a exceção PROPAGA (fail-closed);
//   - `validarBlobImagem` (metadado + magic bytes) só DEPOIS da prova de admin;
//   - path montado SERVER-SIDE `${lojaId}/logo/${uuid}.${ext}` (bucket `produtos`,
//     sem prefixo `produtos/`, nome UUID) — única amarra de isolamento sob service_role;
//   - `schemaStorageUrl` valida a URL pública ANTES do UPDATE (barra URL externa);
//   - UPDATE allowlist `{ logo_url }` via `escopo.atualizarLoja` (escopo por `id`
//     na loja-alvo — nunca um UPDATE cru sem filtro na tabela lojas);
//   - erro genérico ao client, detalhe só em `console.error` (seguranca.md §14);
//   - [galeria] `origem_id` obrigatório validado na loja-alvo, linha-cópia por
//     `escopo.inserir` ANTES do UPDATE, pendentes processados depois.
//
// Módulo `'use server'`: só EXPORTA funções async. `ERRO_GENERICO`/tipos
// ficam locais e não exportados (const exportada daqui quebra só no `next build`).

import {
  validarLojaIdAdmin,
  prepararContextoAdmin,
  registrarAcessoAdmin,
  revalidarLojaAdmin,
} from "@/lib/actions/admin-loja";
import { CAMPO_ARQUIVO } from "@/lib/actions/upload-contrato";
import type { ResultadoLogo, ResultadoSalvarLogo } from "@/lib/actions/logo-contrato";
import {
  CAMPO_ORIGEM,
  MSG_IMAGEM_INVALIDA,
  MSG_LOJA_INVALIDA,
  erroDeEscritaDeImagem,
} from "@/lib/actions/galeria-contrato";
import { subirRecorteDaGaleria } from "@/lib/actions/galeria-upload";
import { processarRemocoesPendentes } from "@/lib/actions/galeria-pendentes";
import { schemaOrigemId } from "@/lib/validacoes/galeria";

const ERRO_GENERICO = "Não foi possível salvar a logo. Tente novamente.";

/**
 * Salva a logo da loja-alvo (`loja_id` da URL, via FormData) sob service_role.
 * O `loja_id` validado é a única autoridade do escopo: vira o 1º segmento do path
 * de Storage, o escopo da origem e da linha-cópia, e o `.eq("id", lojaId)` do
 * UPDATE. Nada vem do auth do admin nem de `file.name`.
 */
export async function salvarLogoAdmin(
  formData: FormData,
): Promise<ResultadoSalvarLogo> {
  // 1. loja_id do FormData → validação UUID ANTES de qualquer efeito. Não-UUID/
  //    ausente → rejeitado, ZERO upload, sem elevar a service_role (anti-DoS).
  const validacaoLoja = validarLojaIdAdmin(formData.get("loja_id"));
  if (!validacaoLoja.ok) {
    return { ok: false, erro: MSG_LOJA_INVALIDA };
  }
  const { lojaId } = validacaoLoja;

  // 2. arquivo presente e origem com forma de uuid. A validação de CONTEÚDO
  //    (CPU/memória) fica DEPOIS da prova de admin.
  const value = formData.get(CAMPO_ARQUIVO);
  if (!(value instanceof Blob) || value.size <= 0) {
    return { ok: false, erro: MSG_IMAGEM_INVALIDA };
  }
  const origem = schemaOrigemId.safeParse(formData.get(CAMPO_ORIGEM));
  if (!origem.success) {
    return { ok: false, erro: MSG_IMAGEM_INVALIDA };
  }

  // 3. prova de admin FORA do try — se `verificarAdminSaaS` lança, PROPAGA
  //    (fail-closed): service client nunca criado, nada é validado nem gravado.
  const { svc, escopo } = await prepararContextoAdmin(lojaId);

  try {
    // 4. blob + origem da LOJA-ALVO + upload em `${lojaId}/logo/${uuid}.${ext}` +
    //    schemaStorageUrl + linha-cópia por `escopo.inserir`, ANTES do UPDATE.
    const recorte = await subirRecorteDaGaleria({
      client: svc,
      lojaId,
      origemId: origem.data,
      destino: "logo",
      arquivo: value,
      exigirUrlDoStorage: true,
      inserir: (linha) => escopo.inserir("imagens_loja", linha),
      erroGenerico: ERRO_GENERICO,
      rotulo: "salvarLogoAdmin",
    });
    if (!recorte.ok) return recorte;
    const logoUrl = recorte.url;

    // 5. UPDATE allowlist `{ logo_url }` escopado por `id` na loja-alvo. O
    //    trigger de M4 vale sob service_role: a recusa vira frase acionável.
    const { error: erroUpdate } = await escopo.atualizarLoja({ logo_url: logoUrl });
    if (erroUpdate) {
      console.error("[salvarLogoAdmin] falha no UPDATE:", erroUpdate);
      return { ok: false, erro: erroDeEscritaDeImagem(erroUpdate, ERRO_GENERICO) };
    }

    // 6. D5: recorte antigo sem uso → Storage. Best-effort.
    await processarRemocoesPendentes(svc, lojaId).catch((e: unknown) =>
      console.error("[salvarLogoAdmin] pendentes da galeria", e),
    );

    registrarAcessoAdmin(svc, {
      lojaId,
      acao: "salvar_logo",
      // path (storage) NÃO é uuid → coluna entidade_id é uuid: vai em metadados (jsonb).
      metadados: { path: recorte.caminho },
    });
    revalidarLojaAdmin(lojaId);

    return { ok: true, logo_url: logoUrl };
  } catch (e) {
    console.error("[salvarLogoAdmin] erro inesperado:", e);
    return { ok: false, erro: ERRO_GENERICO };
  }
}

/**
 * Zera `lojas.logo_url` da loja-alvo (UPDATE `null` escopado por `id`) sob
 * service_role. Mesmo gate de admin do salvar. A original fica na galeria; o
 * recorte sem outro uso é apagado (D5).
 */
export async function removerLogoAdmin(lojaId: string): Promise<ResultadoLogo> {
  // 1. valida `lojaId` ANTES de qualquer efeito.
  const validacaoLoja = validarLojaIdAdmin(lojaId);
  if (!validacaoLoja.ok) {
    return { ok: false, erro: MSG_LOJA_INVALIDA };
  }
  const { lojaId: alvo } = validacaoLoja;

  // 2. prova de admin FORA do try — propaga se lança (fail-closed).
  const { svc, escopo } = await prepararContextoAdmin(alvo);

  try {
    const { error } = await escopo.atualizarLoja({ logo_url: null });
    if (error) {
      console.error("[removerLogoAdmin] falha no UPDATE:", error);
      return { ok: false, erro: erroDeEscritaDeImagem(error, ERRO_GENERICO) };
    }

    await processarRemocoesPendentes(svc, alvo).catch((e: unknown) =>
      console.error("[removerLogoAdmin] pendentes da galeria", e),
    );

    registrarAcessoAdmin(svc, { lojaId: alvo, acao: "remover_logo" });
    revalidarLojaAdmin(alvo);

    return { ok: true };
  } catch (e) {
    console.error("[removerLogoAdmin] erro inesperado:", e);
    return { ok: false, erro: ERRO_GENERICO };
  }
}

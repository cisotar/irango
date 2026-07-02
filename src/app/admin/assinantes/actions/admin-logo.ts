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
//   - erro genérico ao client, detalhe só em `console.error` (seguranca.md §14).
//
// Módulo `'use server'`: só EXPORTA funções async. `BUCKET`/`ERRO_GENERICO`/tipos
// ficam locais e não exportados (const exportada daqui quebra só no `next build`).

import {
  validarLojaIdAdmin,
  prepararContextoAdmin,
  registrarAcessoAdmin,
  revalidarLojaAdmin,
} from "@/lib/actions/admin-loja";
import { validarBlobImagem } from "@/lib/actions/upload-imagem";
import { CAMPO_ARQUIVO } from "@/lib/actions/upload-contrato";
import { schemaStorageUrl } from "@/lib/validacoes/storage";
import type { ResultadoLogo, ResultadoSalvarLogo } from "@/lib/actions/logo-contrato";

const BUCKET = "produtos";
const ERRO_GENERICO = "Não foi possível salvar a logo. Tente novamente.";

/**
 * Salva a logo da loja-alvo (`loja_id` da URL, via FormData) sob service_role.
 * O `loja_id` validado é a única autoridade do escopo: vira o 1º segmento do path
 * de Storage e o `.eq("id", lojaId)` do UPDATE. Qualquer amarra de tenant é
 * reconstruída server-side — nunca do auth do admin nem de `file.name`.
 */
export async function salvarLogoAdmin(
  formData: FormData,
): Promise<ResultadoSalvarLogo> {
  // 1. loja_id do FormData → validação UUID ANTES de qualquer efeito. Não-UUID/
  //    ausente → rejeitado, ZERO upload, sem elevar a service_role (anti-DoS).
  const validacaoLoja = validarLojaIdAdmin(formData.get("loja_id"));
  if (!validacaoLoja.ok) {
    return { ok: false, erro: "Loja inválida." };
  }
  const { lojaId } = validacaoLoja;

  // 2. arquivo presente? Só checa Blob não-vazio aqui; a validação de CONTEÚDO
  //    (CPU/memória) fica DEPOIS da prova de admin.
  const value = formData.get(CAMPO_ARQUIVO);
  if (!(value instanceof Blob) || value.size <= 0) {
    return { ok: false, erro: "Imagem inválida." };
  }
  const file = value;

  // 3. prova de admin FORA do try — se `verificarAdminSaaS` lança, PROPAGA
  //    (fail-closed): service client nunca criado, nada é validado nem gravado.
  const { svc, escopo } = await prepararContextoAdmin(lojaId);

  try {
    // 4. dupla validação da imagem (metadado + magic bytes), DEPOIS da prova.
    const validacao = await validarBlobImagem(file);
    if (!validacao.ok) {
      return { ok: false, erro: validacao.erro };
    }
    const { buffer, tipoReal, ext } = validacao;

    // 5. path SERVER-SIDE `${lojaId}/logo/${uuid}.${ext}` — sem prefixo `produtos/`,
    //    nome UUID (nunca file.name). Sob service_role, o path é o isolamento.
    const path = `${lojaId}/logo/${crypto.randomUUID()}.${ext}`;

    const { error: erroUpload } = await svc.storage
      .from(BUCKET)
      .upload(path, buffer, { contentType: tipoReal });

    if (erroUpload) {
      console.error("[salvarLogoAdmin] falha no upload:", erroUpload);
      return { ok: false, erro: ERRO_GENERICO };
    }

    // 6. schemaStorageUrl ANTES do UPDATE — URL fora do Storage do iRango NÃO persiste.
    const { data } = svc.storage.from(BUCKET).getPublicUrl(path);
    const urlValida = schemaStorageUrl.safeParse(data.publicUrl);
    if (!urlValida.success) {
      console.error("[salvarLogoAdmin] URL pública fora do Storage:", data.publicUrl);
      return { ok: false, erro: ERRO_GENERICO };
    }
    const logoUrl = urlValida.data;

    // 7. UPDATE allowlist `{ logo_url }` escopado por `id` na loja-alvo.
    const { error: erroUpdate } = await escopo.atualizarLoja({ logo_url: logoUrl });
    if (erroUpdate) {
      console.error("[salvarLogoAdmin] falha no UPDATE:", erroUpdate);
      return { ok: false, erro: ERRO_GENERICO };
    }

    registrarAcessoAdmin(svc, {
      lojaId,
      acao: "salvar_logo",
      entidadeId: path,
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
 * service_role. Sem upload, sem Storage. Mesmo gate de admin do salvar.
 */
export async function removerLogoAdmin(lojaId: string): Promise<ResultadoLogo> {
  // 1. valida `lojaId` ANTES de qualquer efeito.
  const validacaoLoja = validarLojaIdAdmin(lojaId);
  if (!validacaoLoja.ok) {
    return { ok: false, erro: "Loja inválida." };
  }
  const { lojaId: alvo } = validacaoLoja;

  // 2. prova de admin FORA do try — propaga se lança (fail-closed).
  const { svc, escopo } = await prepararContextoAdmin(alvo);

  try {
    const { error } = await escopo.atualizarLoja({ logo_url: null });
    if (error) {
      console.error("[removerLogoAdmin] falha no UPDATE:", error);
      return { ok: false, erro: ERRO_GENERICO };
    }

    registrarAcessoAdmin(svc, { lojaId: alvo, acao: "remover_logo" });
    revalidarLojaAdmin(alvo);

    return { ok: true };
  } catch (e) {
    console.error("[removerLogoAdmin] erro inesperado:", e);
    return { ok: false, erro: ERRO_GENERICO };
  }
}

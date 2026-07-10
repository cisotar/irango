"use client";

import { useCallback } from "react";

import {
  PerfilClient,
  type PerfilInicial,
} from "@/app/(painel)/painel/(bloqueavel)/configuracoes/perfil/PerfilClient";
import type { UploadLogoLojaProps } from "@/components/painel/UploadLogoLoja";

import { salvarPerfilAdmin } from "@/app/admin/assinantes/actions/admin-perfil";
import { publicarLojaAdmin } from "@/app/admin/assinantes/actions/admin-publicar";
import {
  salvarLogoAdmin,
  removerLogoAdmin,
} from "@/app/admin/assinantes/actions/admin-logo";

/**
 * Wrapper admin fino da sub-rota de Perfil (issue 152). Reusa o `PerfilClient`
 * parametrizado do painel (097) e INJETA as actions admin (091) com o `lojaId`
 * da URL fixado por closure.
 *
 * Segurança: só fiação de UI. A autoridade (allowlist de colunas, geocoding,
 * gate de `ativo`, magic bytes/path do upload, escopo cross-loja) é das actions
 * admin no servidor. Os adapters de logo (`onSalvarLogo`/`onRemoverLogo`) FIXAM
 * `loja_id = lojaId` da URL — o client nunca é autoridade do escopo (issue 119).
 * `podePublicar` (nome + WhatsApp) é preview; o gate real é revalidado em
 * `publicarLojaAdmin`.
 */
export function PerfilAdminClient({
  lojaId,
  inicial,
  publicado,
  podePublicar,
  logoUrlInicial,
}: {
  lojaId: string;
  inicial: PerfilInicial;
  publicado: boolean;
  podePublicar: boolean;
  logoUrlInicial: string | null;
}) {
  // O `UploadLogoLoja` (via `PerfilClient`) JÁ monta o FormData com o arquivo;
  // aqui só fixamos o `loja_id` da URL (closure) e encaminhamos para a action
  // admin. Quem valida admin + isola a loja-alvo é `salvarLogoAdmin` no servidor.
  const onSalvarLogo = useCallback<NonNullable<UploadLogoLojaProps["onSalvar"]>>(
    (formData) => {
      formData.set("loja_id", lojaId);
      return salvarLogoAdmin(formData);
    },
    [lojaId],
  );

  const onRemoverLogo = useCallback<
    NonNullable<UploadLogoLojaProps["onRemover"]>
  >(() => removerLogoAdmin(lojaId), [lojaId]);

  return (
    <PerfilClient
      inicial={inicial}
      publicado={publicado}
      podePublicar={podePublicar}
      logoUrlInicial={logoUrlInicial}
      onSalvar={(payload) => salvarPerfilAdmin(lojaId, payload)}
      onDefinirPublicacao={(publicar) => publicarLojaAdmin(lojaId, publicar)}
      onSalvarLogo={onSalvarLogo}
      onRemoverLogo={onRemoverLogo}
    />
  );
}

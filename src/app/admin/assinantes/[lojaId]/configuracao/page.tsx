import { permanentRedirect } from "next/navigation";

/**
 * Compat de bookmark após o rename da issue 144: `.../configuracao` (singular)
 * foi movida para `.../configuracoes`. Server Component fininho — só emite um
 * 308 (rename real, path singular morto de vez). A partir da issue 154 aponta
 * direto para a 1ª aba (`.../configuracoes/perfil`), um hop só, em vez de passar
 * pelo índice consolidado. Guard de admin herdado do `admin/assinantes/layout.tsx`;
 * sem carga de dados, sem client, sem vazamento.
 */
export default async function ConfiguracaoRedirectPage({
  params,
}: {
  params: Promise<{ lojaId: string }>;
}): Promise<never> {
  const { lojaId } = await params;
  permanentRedirect(`/admin/assinantes/${lojaId}/configuracoes/perfil`);
}

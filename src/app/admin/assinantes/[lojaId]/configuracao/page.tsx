import { permanentRedirect } from "next/navigation";

/**
 * Compat de bookmark após o rename da issue 144: `.../configuracao` foi movida
 * para `.../configuracoes`. Server Component fininho — só emite um 308 para a
 * URL canônica. Guard de admin herdado do `admin/assinantes/layout.tsx`; sem
 * carga de dados, sem client, sem vazamento.
 */
export default async function ConfiguracaoRedirectPage({
  params,
}: {
  params: Promise<{ lojaId: string }>;
}): Promise<never> {
  const { lojaId } = await params;
  permanentRedirect(`/admin/assinantes/${lojaId}/configuracoes`);
}

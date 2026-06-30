import { redirect } from "next/navigation";

/**
 * Índice do hub da loja-alvo (issue 099). Sem conteúdo próprio: redireciona para
 * a aba default (Cardápio). O cabeçalho + abas vivem no `layout.tsx`, que envolve
 * todas as sub-rotas. O guard de admin e o `notFound()` de loja inexistente já
 * acontecem no layout (via `carregarCabecalhoLojaAdmin`) antes deste redirect.
 */
export default async function HubLojaPage({
  params,
}: {
  params: Promise<{ lojaId: string }>;
}): Promise<never> {
  const { lojaId } = await params;
  redirect(`/admin/assinantes/${lojaId}/cardapio`);
}

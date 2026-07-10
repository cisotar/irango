import { redirect } from "next/navigation";

/**
 * Índice de configurações do hub admin (issue 154). Server Component
 * redirect-only: delega à aba-default (Perfil) das sub-rotas criadas em 152/153.
 *
 * 307 Temporary (`redirect`, NÃO `permanentRedirect`/308): o namespace
 * `.../configuracoes/*` segue vivo (é o pai das 6 sub-rotas); só a renderização
 * do índice delega à 1ª aba. 307 mantém o índice reavaliado a cada visita e
 * preserva o método GET — nada a cachear para sempre.
 *
 * Sem carga de dados, sem client, sem valor autoritativo. O guard de admin
 * (`verificarAdminSaaS()`) é herdado do `admin/assinantes/layout.tsx` e roda
 * antes deste redirect; a permissão de cada aba é garantida na própria aba.
 */
export default async function ConfiguracaoIndexPage({
  params,
}: {
  params: Promise<{ lojaId: string }>;
}): Promise<never> {
  const { lojaId } = await params;
  redirect(`/admin/assinantes/${lojaId}/configuracoes/perfil`);
}

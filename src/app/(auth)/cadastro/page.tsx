// /cadastro — Server Component wrapper. Lê `searchParams` (Promise no Next 16)
// e passa `erroOAuth` para o form cliente. Sem `useSearchParams`/`Suspense`: o
// servidor já tem o param, evita o gotcha de prerender (003).
import { CadastroForm } from "./CadastroForm";

export default async function CadastroPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string }>;
}) {
  const params = await searchParams;
  return <CadastroForm erroOAuth={params.erro === "google"} />;
}

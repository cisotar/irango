// /login — Server Component wrapper. Lê `searchParams` (Promise no Next 16) e
// passa `erroOAuth` e `senhaRedefinida` para o form cliente. Sem `useSearchParams`/`Suspense`: o
// servidor já tem o param, evita o gotcha de prerender (003).
import { LoginForm } from "./LoginForm";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string; redefinida?: string }>;
}) {
  const params = await searchParams;
  return <LoginForm erroOAuth={params.erro === "google"} senhaRedefinida={params.redefinida === "1"} />;
}

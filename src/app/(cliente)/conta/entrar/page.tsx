// /conta/entrar — porta cliente (specs/cliente-identidade.md "Entrar").
// `searchParams` é Promise no Next 16; o servidor resolve `next`/`erro` e passa
// ao form (sem useSearchParams/Suspense).
import { TopoConta } from "@/components/cliente/TopoConta";
import { sanitizarNext } from "@/lib/utils/sanitizarNext";
import { primeiro, redirecionarSeLogado } from "../sessao";
import { FormEntrarCliente } from "./FormEntrarCliente";

/** D3 + decisão 18 (`confirme` vem do guard de /minha-conta). */
const MENSAGENS_ERRO: Record<string, string> = {
  google: "Não foi possível entrar com o Google. Tente novamente.",
  sessao: "Sua sessão expirou. Entre novamente.",
  confirme: "Confirme seu e-mail para entrar. Enviamos um link para você.",
};

export default async function EntrarClientePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const next = sanitizarNext(primeiro(params.next));
  await redirecionarSeLogado(next);
  const erro = primeiro(params.erro);

  return (
    <>
      <TopoConta next={next} />
      <FormEntrarCliente next={next} erroInicial={erro ? (MENSAGENS_ERRO[erro] ?? null) : null} />
    </>
  );
}

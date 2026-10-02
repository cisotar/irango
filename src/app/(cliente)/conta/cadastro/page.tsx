// /conta/cadastro — porta cliente (specs/cliente-identidade.md "Cadastro").
import { TopoConta } from "@/components/cliente/TopoConta";
import { sanitizarNext } from "@/lib/utils/sanitizarNext";
import { primeiro, redirecionarSeLogado } from "../sessao";
import { FormCadastroCliente } from "./FormCadastroCliente";

export default async function CadastroClientePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const next = sanitizarNext(primeiro(params.next));
  await redirecionarSeLogado(next);

  return (
    <>
      <TopoConta next={next} />
      <FormCadastroCliente next={next} />
    </>
  );
}

// /conta/recuperar — recuperação por link (decisão 10 alterada). Etapa 1:
// pedir o link. Etapa 2 (`?etapa=nova-senha`): só com sessão de RECUPERAÇÃO
// (claim `amr` = recovery, mesmo critério de `redefinirSenhaCliente`); sem ela,
// ou com `?erro=link` (C1, vindo do callback), estado de erro sem formulário.
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { sanitizarNext } from "@/lib/utils/sanitizarNext";
import { temSessaoDeRecuperacao } from "@/lib/auth/temSessaoDeRecuperacao";
import { TopoConta } from "@/components/cliente/TopoConta";
import { AlertaErro } from "@/components/cliente/Alerta";
import { comNext } from "@/components/cliente/rotas";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { primeiro } from "../sessao";
import { FormRecuperarCliente } from "./FormRecuperarCliente";
import { FormNovaSenhaCliente } from "./FormNovaSenhaCliente";

const MSG_LINK = "Link inválido ou expirado. Peça um novo link.";

/** UX: a action repete a checagem; aqui só decide se o formulário aparece. */
async function podeTrocarSenha(): Promise<boolean> {
  try {
    return await temSessaoDeRecuperacao(await createClient());
  } catch (e) {
    console.error("[recuperarCliente] sessao", e instanceof Error ? e.name : "erro");
    return false;
  }
}

export default async function RecuperarClientePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const next = sanitizarNext(primeiro(params.next));
  const etapaNovaSenha = primeiro(params.etapa) === "nova-senha";
  const linkInvalido =
    primeiro(params.erro) === "link" || (etapaNovaSenha && !(await podeTrocarSenha()));

  if (linkInvalido) {
    return (
      <>
        <TopoConta next={next} />
        <Card>
          <CardHeader>
            <CardTitle className="text-center text-xl">Recuperar senha</CardTitle>
          </CardHeader>
          <CardContent>
            <AlertaErro>{MSG_LINK}</AlertaErro>
            <Link
              href={comNext("/conta/recuperar", next)}
              className={buttonVariants({ className: "min-h-11 w-full" })}
            >
              Pedir novo link
            </Link>
          </CardContent>
        </Card>
      </>
    );
  }

  return (
    <>
      <TopoConta next={next} />
      {etapaNovaSenha ? <FormNovaSenhaCliente next={next} /> : <FormRecuperarCliente next={next} />}
    </>
  );
}

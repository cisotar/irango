// /conta/completar — passo complementar único (pós-Google, pós-confirmação do
// e-mail e ativação por lojista/admin). Exige sessão com e-mail confirmado;
// conta que já tem papel `cliente` + perfil segue para `next` ou /minha-conta.
// Papéis lidos da tabela (RLS), nunca do JWT.
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { buscarPapeisDoUsuario } from "@/lib/supabase/queries/papeis";
import { buscarPerfilCliente } from "@/lib/supabase/queries/clientes";
import { ehAdminSaaS } from "@/lib/auth/admin";
import { sanitizarNext } from "@/lib/utils/sanitizarNext";
import { TopoConta } from "@/components/cliente/TopoConta";
import { FormPerfilCliente } from "@/components/cliente/FormPerfilCliente";
import { comNext } from "@/components/cliente/rotas";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { primeiro } from "../sessao";

/** Nome vindo do Google (pré-preenchimento editável); nunca autoritativo. */
function nomeDoProvedor(user: User): string {
  const meta = user.user_metadata as Record<string, unknown> | undefined;
  const nome = meta?.full_name ?? meta?.name;
  return typeof nome === "string" ? nome.trim().slice(0, 120) : "";
}

type Estado =
  | { tipo: "sem-sessao" }
  | { tipo: "nao-confirmado" }
  | { tipo: "completo" }
  | { tipo: "erro" }
  | { tipo: "form"; nome: string; avisoPainel: boolean };

export default async function CompletarPerfilPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const next = sanitizarNext(primeiro(params.next));

  let estado: Estado;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      estado = { tipo: "sem-sessao" };
    } else if (!data.user.email_confirmed_at) {
      await supabase.auth.signOut();
      estado = { tipo: "nao-confirmado" };
    } else {
      const user = data.user;
      const [papeis, perfil] = await Promise.all([
        buscarPapeisDoUsuario(supabase, user.id),
        buscarPerfilCliente(supabase, user.id),
      ]);
      estado =
        papeis.includes("cliente") && perfil
          ? { tipo: "completo" }
          : {
              tipo: "form",
              nome: nomeDoProvedor(user),
              avisoPainel: papeis.includes("lojista") || ehAdminSaaS(user.id),
            };
    }
  } catch (e) {
    console.error("[completarPerfil]", e instanceof Error ? e.name : "erro");
    estado = { tipo: "erro" };
  }

  switch (estado.tipo) {
    case "sem-sessao":
      redirect(comNext("/conta/entrar", comNext("/conta/completar", next)));
    case "nao-confirmado":
      redirect("/conta/entrar?erro=confirme");
    case "erro":
      redirect("/conta/entrar?erro=sessao");
    case "completo":
      redirect(next ?? "/minha-conta");
    case "form":
      return (
        <>
          <TopoConta next={next} />
          <Card>
            <CardHeader>
              <CardTitle className="text-center text-xl">Complete seu perfil</CardTitle>
            </CardHeader>
            <CardContent>
              <FormPerfilCliente
                modo="completar"
                nomeInicial={estado.nome}
                avisoPainel={estado.avisoPainel}
                next={next}
              />
            </CardContent>
          </Card>
        </>
      );
  }
}

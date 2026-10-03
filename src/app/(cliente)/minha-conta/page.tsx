// /minha-conta — perfil do cliente (área logada). Guard em `guard.ts`
// (repetido aqui com a rota da página). Dados lidos com o client da sessão:
// RLS escopa por auth.uid().
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { listarEnderecosCliente } from "@/lib/supabase/queries/clientes";
import { MAX_ENDERECOS } from "@/lib/validacoes/cliente";
import { ehAdminSaaS } from "@/lib/auth/admin";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormPerfilCliente } from "@/components/cliente/FormPerfilCliente";
import { LinkVoltarLoja } from "@/components/cliente/LinkVoltarLoja";
import { comNext } from "@/components/cliente/rotas";
import { sanitizarNext } from "@/lib/utils/sanitizarNext";
import { primeiro } from "../conta/sessao";
import { exigirCliente } from "./guard";
import { BotaoSair } from "@/components/cliente/BotaoSair";
import { ExcluirConta } from "./ExcluirConta";

export default async function MinhaContaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { supabase, user, perfil, papeis } = await exigirCliente("/minha-conta");
  // Veio do menu da vitrine: `next=/loja/<slug>` vira "Voltar para <loja>" e
  // segue nos links internos da conta.
  const next = sanitizarNext(primeiro((await searchParams).next));

  let totalEnderecos: number | null = null;
  try {
    totalEnderecos = (await listarEnderecosCliente(supabase, user.id)).length;
  } catch (e) {
    console.error("[minhaConta] enderecos", e instanceof Error ? e.name : "erro");
  }

  // D8: lojista/admin + cliente perdem só o perfil (texto do aviso muda).
  const soPerfil = papeis.includes("lojista") || ehAdminSaaS(user.id);

  return (
    <div className="flex flex-col gap-4">
      <LinkVoltarLoja next={next} className="self-start" />
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold text-texto">Minha conta</h1>
        <BotaoSair next={next} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Dados pessoais</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div>
            <p className="text-sm font-medium text-texto">E-mail</p>
            <p className="text-sm break-all text-texto-muted">{user.email}</p>
          </div>
          <FormPerfilCliente
            modo="editar"
            inicial={{
              nome: perfil.nome,
              telefone: perfil.telefone,
              data_nascimento: perfil.data_nascimento,
              aceita_marketing: perfil.aceita_marketing,
            }}
          />
        </CardContent>
      </Card>

      <Link
        href={comNext("/minha-conta/enderecos", next)}
        className="rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Card className="transition-colors hover:bg-muted/50">
          <CardContent className="flex min-h-11 items-center justify-between gap-2">
            <div>
              <p className="font-medium text-texto">Endereços</p>
              {totalEnderecos !== null && (
                <p className="text-sm text-texto-muted">{totalEnderecos} de {MAX_ENDERECOS} cadastrados</p>
              )}
            </div>
            <ChevronRight className="size-5 text-texto-muted" aria-hidden="true" />
          </CardContent>
        </Card>
      </Link>

      <Link
        href={comNext("/minha-conta/pedidos", next)}
        className="rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Card className="transition-colors hover:bg-muted/50">
          <CardContent className="flex min-h-11 items-center justify-between gap-2">
            <p className="font-medium text-texto">Pedidos</p>
            <ChevronRight className="size-5 text-texto-muted" aria-hidden="true" />
          </CardContent>
        </Card>
      </Link>

      <ExcluirConta soPerfil={soPerfil} />
    </div>
  );
}

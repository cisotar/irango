// /minha-conta/enderecos — até 3 endereços (decisão 8). Guard repetido com a
// rota da página; lista lida com o client da sessão (RLS por auth.uid()).
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { listarEnderecosCliente, type EnderecoCliente } from "@/lib/supabase/queries/clientes";
import { exigirCliente } from "../guard";
import { ListaEnderecos } from "./ListaEnderecos";

export default async function EnderecosPage() {
  const { supabase, user } = await exigirCliente("/minha-conta/enderecos");

  let enderecos: EnderecoCliente[];
  try {
    enderecos = await listarEnderecosCliente(supabase, user.id);
  } catch (e) {
    console.error("[enderecos]", e instanceof Error ? e.name : "erro");
    redirect("/conta/entrar?erro=sessao");
  }

  return (
    <div className="flex flex-col gap-4">
      <Link
        href="/minha-conta"
        className="inline-flex min-h-11 items-center gap-2 self-start rounded-md text-sm font-medium text-texto underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Minha conta
      </Link>
      <ListaEnderecos enderecos={enderecos} />
    </div>
  );
}

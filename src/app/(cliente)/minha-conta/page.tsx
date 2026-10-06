// /minha-conta — página única da área logada do cliente: Dados pessoais,
// Endereços e Pedidos, sempre expandidos, com âncoras para a navegação lateral
// (`ShellConta`, no layout). Guard em `guard.ts` (repetido aqui com a rota da
// página). Dados lidos com o client da sessão: RLS escopa por auth.uid().
// Endereços e Pedidos são os mesmos componentes das páginas dedicadas.
import type { ReactNode } from "react";
import { listarEnderecosCliente, type EnderecoCliente } from "@/lib/supabase/queries/clientes";
import { Card, CardContent } from "@/components/ui/card";
import { FormPerfilCliente } from "@/components/cliente/FormPerfilCliente";
import { LinkVoltarLoja } from "@/components/cliente/LinkVoltarLoja";
import { carregarHistorico, HistoricoPedidos, type Historico } from "@/components/cliente/HistoricoPedidos";
import { hrefCarregarMais, paginaDoParam } from "@/components/cliente/historicoPedidos";
import { ROTA_MINHA_CONTA, SECOES_CONTA, type IdSecaoConta } from "@/components/cliente/conta/secoesConta";
import { sanitizarNext } from "@/lib/utils/sanitizarNext";
import { ListaEnderecos } from "./enderecos/ListaEnderecos";
import { primeiro } from "../conta/sessao";
import { exigirCliente } from "./guard";

const rotulo = (id: IdSecaoConta) => SECOES_CONTA.find((s) => s.id === id)?.rotulo ?? "";
const idTitulo = (id: IdSecaoConta) => `titulo-${id}`;

/** Seção-âncora: `scroll-mt` deixa o título abaixo do kebab fixo; `tabIndex` recebe o foco da navegação. */
function Secao({ id, children }: { id: IdSecaoConta; children: ReactNode }) {
  return (
    <section
      id={id}
      tabIndex={-1}
      aria-labelledby={idTitulo(id)}
      className="flex scroll-mt-18 flex-col gap-3 focus:outline-none"
    >
      {children}
    </section>
  );
}

function TituloSecao({ id }: { id: IdSecaoConta }) {
  return (
    <h2 id={idTitulo(id)} className="text-lg font-semibold text-texto">
      {rotulo(id)}
    </h2>
  );
}

function FalhaLeitura({ children }: { children: ReactNode }) {
  return (
    <Card>
      <CardContent className="py-8 text-center text-sm text-texto-muted">{children}</CardContent>
    </Card>
  );
}

export default async function MinhaContaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { supabase, user, perfil } = await exigirCliente(ROTA_MINHA_CONTA);
  const params = await searchParams;
  // Veio do menu da vitrine: `next=/loja/<slug>` vira "Voltar para <loja>" e
  // segue nos links internos da conta.
  const next = sanitizarNext(primeiro(params.next));
  const pagina = paginaDoParam(primeiro(params.pagina));

  // Falha de uma leitura não derruba a página: a seção mostra aviso genérico
  // (detalhe só no log do servidor).
  const [enderecos, historico] = await Promise.all([
    listarEnderecosCliente(supabase, user.id).catch((e): EnderecoCliente[] | null => {
      console.error("[minhaConta] enderecos", e instanceof Error ? e.name : "erro");
      return null;
    }),
    carregarHistorico(supabase, user.id, pagina).catch((e): Historico | null => {
      console.error("[minhaConta] pedidos", e instanceof Error ? e.name : "erro");
      return null;
    }),
  ]);

  return (
    <div className="flex flex-col">
      <LinkVoltarLoja next={next} className="self-start" />
      <h1 className="mt-2 text-2xl font-semibold text-texto">Minha conta</h1>

      <div className="mt-5 flex flex-col gap-8">
        <Secao id="dados-pessoais">
          <TituloSecao id="dados-pessoais" />
          <Card>
            <CardContent className="lg:px-6">
              <FormPerfilCliente
                modo="editar"
                email={user.email ?? ""}
                inicial={{
                  nome: perfil.nome,
                  telefone: perfil.telefone,
                  data_nascimento: perfil.data_nascimento,
                  aceita_marketing: perfil.aceita_marketing,
                }}
              />
            </CardContent>
          </Card>
        </Secao>

        <Secao id="enderecos">
          {enderecos ? (
            <ListaEnderecos
              enderecos={enderecos}
              titulo={{ nivel: "h2", texto: rotulo("enderecos"), id: idTitulo("enderecos") }}
            />
          ) : (
            <>
              <TituloSecao id="enderecos" />
              <FalhaLeitura>Não foi possível carregar seus endereços. Recarregue a página.</FalhaLeitura>
            </>
          )}
        </Secao>

        <Secao id="pedidos">
          <TituloSecao id="pedidos" />
          {historico ? (
            <HistoricoPedidos
              historico={historico}
              hrefMais={hrefCarregarMais(ROTA_MINHA_CONTA, pagina, next, "pedidos")}
            />
          ) : (
            <FalhaLeitura>Não foi possível carregar seus pedidos. Recarregue a página.</FalhaLeitura>
          )}
        </Secao>
      </div>
    </div>
  );
}

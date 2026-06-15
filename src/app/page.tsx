import Link from "next/link";
import { Palette, Smartphone, BadgeDollarSign } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FooterPublico } from "@/components/FooterPublico";

/**
 * Landing do SaaS (issue 038). Página estática (SSG) de marca — usa os tokens do
 * iRango (não tema de loja). O redirect de usuário autenticado para `/painel` é
 * feito no middleware (issue 016), não aqui.
 */
export default function Home() {
  return (
    <div className="flex min-h-screen flex-col bg-fundo text-texto">
      <header className="flex items-center justify-between px-6 py-4">
        <span className="text-lg font-black uppercase tracking-wide text-marrom-cafe">
          🥖 iRango
        </span>
        <Button variant="ghost" render={<Link href="/login">Entrar</Link>} />
      </header>

      <HeroLanding />
      <SecaoBeneficios />
      <SecaoCTA />

      <FooterPublico />
    </div>
  );
}

function CtaCriarLoja() {
  return (
    <Button
      className="min-h-11 bg-[var(--cor-primaria)] text-base text-white hover:bg-[var(--cor-primaria)]/90"
      render={<Link href="/cadastro">Crie sua loja grátis</Link>}
    />
  );
}

function HeroLanding() {
  return (
    <section className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-12 md:py-20">
      <div className="flex flex-col gap-5">
        <h1 className="text-3xl font-bold leading-tight text-marrom-cafe md:text-5xl">
          Crie sua loja online em minutos
        </h1>
        <p className="max-w-xl text-base text-texto-muted md:text-lg">
          Receba pedidos pelo celular e venda sem mensalidade fixa nem taxa de
          marketplace. Você no controle da sua vitrine.
        </p>
        <div className="flex flex-col items-start gap-2">
          <CtaCriarLoja />
          <p className="text-sm text-texto-muted">
            Já tem conta?{" "}
            <Link href="/login" className="underline">
              Entrar
            </Link>
          </p>
        </div>
      </div>
    </section>
  );
}

const BENEFICIOS = [
  {
    icone: Palette,
    titulo: "Vitrine própria",
    texto: "Personalize a vitrine com a marca e as cores da sua loja.",
  },
  {
    icone: Smartphone,
    titulo: "Gestão de pedidos",
    texto:
      "Seus clientes compram pelo celular — sem app, sem login, sem fricção.",
  },
  {
    icone: BadgeDollarSign,
    titulo: "Sem taxa de adesão",
    texto: "Sem comissão por pedido. Você fica com o valor das suas vendas.",
  },
] as const;

function SecaoBeneficios() {
  return (
    <section className="mx-auto w-full max-w-5xl px-6 py-12">
      <h2 className="mb-6 text-2xl font-bold text-marrom-cafe">
        Por que o iRango
      </h2>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {BENEFICIOS.map(({ icone: Icone, titulo, texto }) => (
          <Card key={titulo} className="flex flex-col gap-2 p-6">
            <Icone aria-hidden className="size-8 text-[var(--cor-destaque)]" />
            <h3 className="text-lg font-semibold text-texto">{titulo}</h3>
            <p className="text-sm text-texto-muted">{texto}</p>
          </Card>
        ))}
      </div>
    </section>
  );
}

function SecaoCTA() {
  return (
    <section className="mx-auto flex w-full max-w-5xl flex-col items-center gap-5 px-6 py-12 text-center">
      <h2 className="text-2xl font-bold text-marrom-cafe">
        Comece a vender hoje
      </h2>
      <CtaCriarLoja />
    </section>
  );
}

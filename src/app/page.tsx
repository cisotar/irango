import Link from "next/link";
import {
  Store,
  Bike,
  Ticket,
  MessageCircle,
  Layers,
  Printer,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { FooterPublico } from "@/components/FooterPublico";

/**
 * Landing do SaaS (issue 038). Página estática (SSG) de marca — usa os tokens do
 * iRango (não tema de loja). O redirect de usuário autenticado para `/painel` é
 * feito no middleware (issue 016), não aqui.
 *
 * Visual espelha o mockup `design-claude/landing.html` (fonte única do visual —
 * ver `design-claude/`), reescrito em Tailwind com os tokens do design system
 * (`cor-primaria`/`cor-destaque`/`marrom-cafe`/`texto-muted`/`borda-nav`).
 */
export default function Home() {
  return (
    <div className="flex min-h-screen flex-col bg-fundo text-texto">
      <Topbar />
      <main>
        <HeroLanding />
        <SecaoBeneficios />
        <SecaoCTA />
      </main>
      <FooterPublico />
    </div>
  );
}

function Topbar() {
  return (
    <header className="sticky top-0 z-50 flex h-15 items-center justify-between bg-primaria px-6 text-white shadow-md">
      <span className="text-lg font-black tracking-wide uppercase">🥖 iRango</span>
      <nav className="flex items-center gap-1" aria-label="Navegação principal">
        <Link
          href="#como-funciona"
          className="hidden rounded-lg px-3 py-2 text-sm font-semibold text-white/85 transition-colors hover:bg-white/10 sm:inline-flex"
        >
          Como funciona
        </Link>
        <Link
          href="/login"
          className="hidden rounded-lg px-3 py-2 text-sm font-semibold text-white/85 transition-colors hover:bg-white/10 sm:inline-flex"
        >
          Entrar
        </Link>
        <Button
          className="rounded-[10px] bg-white text-primaria hover:bg-fundo"
          nativeButton={false}
          render={<Link href="/cadastro">Criar conta</Link>}
        />
      </nav>
    </header>
  );
}

function HeroLanding() {
  return (
    <section
      className="flex flex-col items-center gap-6 px-6 py-18 text-center"
      style={{
        background:
          "linear-gradient(180deg, var(--cor-primaria) 0%, #4a3220 50%, var(--cor-fundo) 100%)",
      }}
    >
      <span className="inline-flex items-center gap-1.5 rounded-full border border-white/25 bg-white/10 px-4 py-1.5 text-xs font-bold tracking-wide text-white/90 uppercase">
        <span aria-hidden>★</span> SaaS para comércio local
      </span>

      <h1 className="max-w-2xl text-4xl leading-[1.1] font-black text-balance text-white uppercase md:text-6xl">
        Crie sua loja online{" "}
        <span className="text-[#f5c57a]">em minutos</span>
      </h1>

      <p className="max-w-lg text-base leading-relaxed text-white/80 md:text-lg">
        Do cadastro ao primeiro pedido, tudo no iRango. Cardápio digital com
        opcionais, pedido direto no WhatsApp, entrega configurável e cupons de
        desconto — sem mensalidade para começar.
      </p>

      <div className="flex flex-wrap items-center justify-center gap-3">
        <Button
          size="lg"
          className="h-13 rounded-xl bg-destaque px-7 text-base font-bold tracking-wide text-white uppercase shadow-lg hover:bg-destaque/90"
          nativeButton={false}
          render={<Link href="/cadastro">Crie sua loja grátis</Link>}
        />
        <Button
          size="lg"
          variant="outline"
          className="h-13 rounded-xl border-2 border-white/50 bg-transparent px-6 text-base font-semibold text-white hover:border-white/80 hover:bg-white/10"
          nativeButton={false}
          render={<Link href="#como-funciona">Ver como funciona</Link>}
        />
      </div>

      <p className="mt-4 flex items-center gap-2 text-sm text-texto-muted">
        <span className="tracking-widest text-[#f5c57a]" aria-label="5 estrelas">
          ★★★★★
        </span>
        Mais de 200 lojistas ativos
      </p>
    </section>
  );
}

const BENEFICIOS = [
  {
    icone: Store,
    titulo: "Vitrine pronta em minutos",
    texto:
      "Cadastre seus produtos, configure o horário de funcionamento e compartilhe o link. Seus clientes já conseguem pedir.",
  },
  {
    icone: Bike,
    titulo: "Entrega configurável por zona",
    texto:
      "Defina zonas de entrega com frete por bairro ou por distância (raio). O sistema calcula o valor certo na hora do pedido.",
  },
  {
    icone: Ticket,
    titulo: "Cupons de desconto",
    texto:
      "Crie cupons de percentual ou valor fixo com validade e limite de uso. Ideal para fidelizar clientes e aumentar o ticket médio.",
  },
  {
    icone: MessageCircle,
    titulo: "Pedido direto no WhatsApp",
    texto:
      "O pedido finalizado chega pronto no seu WhatsApp, com itens, endereço e forma de pagamento. Sem app extra, sem intermediário.",
  },
  {
    icone: Layers,
    titulo: "Opcionais e adicionais",
    texto:
      "Monte produtos com opções e adicionais — tamanho, borda, acompanhamento. O cliente escolhe e o valor certo é calculado na hora.",
  },
  {
    icone: Printer,
    titulo: "Comanda e recibo prontos",
    texto:
      "Cada pedido gera comanda de cozinha e recibo do cliente prontos para imprimir. A produção anda sem digitar nada de novo.",
  },
] as const;

function SecaoBeneficios() {
  return (
    <section
      id="como-funciona"
      className="mx-auto max-w-5xl px-6 py-16"
      aria-labelledby="titulo-beneficios"
    >
      <h2
        id="titulo-beneficios"
        className="text-center text-2xl font-black tracking-wide text-marrom-cafe uppercase md:text-3xl"
      >
        Por que o iRango?
      </h2>
      <p className="mt-3 mb-12 text-center text-texto-muted">
        Tudo que você precisa para vender online, sem complicação.
      </p>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {BENEFICIOS.map(({ icone: Icone, titulo, texto }) => (
          <article
            key={titulo}
            className="flex flex-col gap-3 rounded-xl border border-borda-nav bg-white p-6 shadow-[0_4px_12px_var(--sombra-suave)]"
          >
            <div className="flex size-13 items-center justify-center rounded-2xl bg-fundo">
              <Icone aria-hidden className="size-6 text-destaque" />
            </div>
            <h3 className="text-base font-black text-marrom-cafe">{titulo}</h3>
            <p className="text-sm leading-relaxed text-texto-muted">{texto}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function SecaoCTA() {
  return (
    <section className="bg-primaria px-6 py-16 text-center" aria-labelledby="cta-titulo">
      <h2
        id="cta-titulo"
        className="text-2xl font-black tracking-wide text-white uppercase md:text-4xl"
      >
        Pronto para começar?
      </h2>
      <p className="mt-3 mb-9 text-white/75">
        Crie sua conta agora e comece a receber pedidos hoje mesmo.
      </p>
      <Button
        size="lg"
        className="h-14 rounded-xl bg-white px-9 text-base font-black tracking-wide text-primaria uppercase shadow-lg hover:bg-fundo"
        nativeButton={false}
        render={<Link href="/cadastro">Crie sua loja grátis</Link>}
      />
      <p className="mt-3 text-xs text-white/55">
        Sem cartão de crédito. Cancele quando quiser.
      </p>
    </section>
  );
}

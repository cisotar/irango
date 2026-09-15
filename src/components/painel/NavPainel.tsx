"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ArrowLeft,
  BadgeCheck,
  ClipboardList,
  Clock,
  CreditCard,
  ExternalLink,
  LayoutDashboard,
  ListPlus,
  LogOut,
  Menu,
  Package,
  Palette,
  Settings,
  Ticket,
  Truck,
  User,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { fotoSegura } from "@/lib/utils/fotoSegura";
import type { Horarios } from "@/lib/utils/lojaAberta";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { BadgeStatus } from "@/components/vitrine/BadgeStatus";
import { createClient } from "@/lib/supabase/client";

type SubItemNav = { href: string; rotulo: string; icone: LucideIcon };

type ItemNav = {
  href: string;
  rotulo: string;
  icone: LucideIcon;
  /** Sub-rotas exatas do item. */
  subitens?: SubItemNav[];
  /**
   * Pai que é só RÓTULO DE GRUPO: não existe `page.tsx` em `href` (o link
   * dava 404 — issue 194/F3), então vira gatilho de sanfona, não `<Link>`.
   */
  grupo?: boolean;
};

/**
 * Contexto que parametriza o shell de navegação. TODO opcional → o default
 * (`{}`) reproduz o painel do lojista (`/painel`, Assinatura visível,
 * Configurações como grupo). Só primitivos/dados serializáveis: os ícones
 * (`LucideIcon`) NUNCA cruzam a fronteira RSC→client — são resolvidos aqui
 * dentro, no módulo `'use client'`, por `construirItens`.
 *
 * A identidade da loja (`nomeLoja`/`logoUrl`/`slugLoja`) e o status
 * (`horarios`+`timezone`) são do SHELL DO LOJISTA. O hub admin não os passa de
 * propósito (issue 194): lá a identidade vive na faixa persistente da coluna de
 * conteúdo (issue 145), visível nos dois breakpoints.
 */
export type ContextoNav = {
  /** Raiz das rotas do menu. Default `/painel`. */
  basePath?: string;
  /** Título exibido no topo do menu quando não há `nomeLoja`. Default `iRango`. */
  titulo?: string;
  /** Nome da loja gerenciada (F1). Sem ele, cai no `titulo`. */
  nomeLoja?: string;
  /** Logo da loja (F1). Passa por `fotoSegura` antes de virar `src`. */
  logoUrl?: string | null;
  /** Slug da loja (F1) — habilita o atalho "Ver vitrine". */
  slugLoja?: string;
  /** Horários da loja (F2). Só rende `BadgeStatus` junto com `timezone`. */
  horarios?: Horarios;
  /** Timezone da loja (F2). */
  timezone?: string;
  /** E-mail da conta logada, no rodapé (F10). */
  emailConta?: string;
  /** Link de volta no rodapé. Ausente → nada renderiza. */
  voltarHref?: string;
  /** Rótulo do link de volta. Default "Voltar". */
  voltarRotulo?: string;
};

/**
 * Gera os itens do menu a partir do `basePath`, reescrevendo hrefs relativos à
 * base e mantendo ordem/ícones/rótulos idênticos. Helper puro DENTRO do módulo
 * client (ícones não cruzam a fronteira RSC). Sem contexto → itens do lojista.
 */
function construirItens(contexto: ContextoNav = {}): ItemNav[] {
  const base = contexto.basePath ?? "/painel";

  const itemConfiguracoes: ItemNav = {
    href: `${base}/configuracoes`,
    rotulo: "Configurações",
    icone: Settings,
    grupo: true,
    subitens: [
      { href: `${base}/configuracoes/perfil`, rotulo: "Perfil", icone: User },
      {
        href: `${base}/configuracoes/horarios`,
        rotulo: "Horários",
        icone: Clock,
      },
      {
        href: `${base}/configuracoes/entregas`,
        rotulo: "Entregas",
        icone: Truck,
      },
      {
        href: `${base}/configuracoes/pagamentos`,
        rotulo: "Pagamentos",
        icone: CreditCard,
      },
      { href: `${base}/configuracoes/tema`, rotulo: "Tema", icone: Palette },
      {
        href: `${base}/configuracoes/assinatura`,
        rotulo: "Assinatura",
        icone: BadgeCheck,
      },
    ],
  };

  return [
    { href: base, rotulo: "Dashboard", icone: LayoutDashboard },
    { href: `${base}/pedidos`, rotulo: "Pedidos", icone: ClipboardList },
    {
      href: `${base}/produtos`,
      rotulo: "Produtos",
      icone: Package,
      // Produtos TEM página própria (`/produtos` é a listagem), então continua
      // `<Link>` — só Configurações vira gatilho de sanfona.
      subitens: [
        {
          href: `${base}/produtos/opcionais`,
          rotulo: "Opcionais",
          icone: ListPlus,
        },
      ],
    },
    { href: `${base}/cupons`, rotulo: "Cupons", icone: Ticket },
    itemConfiguracoes,
  ];
}

/**
 * A `raiz` (basePath) é prefixo de tudo — só está ativa em correspondência
 * exata. Demais itens ativam por prefixo (cobre sub-rotas como /pedidos/[id]).
 */
function estaAtivo(pathname: string, href: string, raiz: string): boolean {
  if (href === raiz) return pathname === raiz;
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Nome exibido e presença de status (F1/F2) — mesma leitura em desktop e mobile. */
function identidadeLoja(contexto: ContextoNav): {
  nome: string;
  temStatus: boolean;
} {
  return {
    nome: contexto.nomeLoja ?? contexto.titulo ?? "iRango",
    temStatus: contexto.horarios != null && contexto.timezone != null,
  };
}

/**
 * Classe base do alvo de navegação. `py-2.5` + `text-sm` = 12 + 24 + 12 = 48px
 * (F4, ≥44px). `relative` existe para a barra de ativo ser `::before` — fora do
 * fluxo, sem deslocar o rótulo a cada navegação (F7). Cores só da família
 * `--sidebar-*`: o painel NUNCA pinta estado de navegação com `lojas.tema`.
 */
const CLASSE_ITEM =
  "relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-sidebar-foreground/70 outline-none transition-colors hover:bg-sidebar-accent/50 hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:ring-offset-2";

/** Ativo ≠ hover (F6): fundo cheio + peso + barra; hover é meio-tom. */
const CLASSE_ITEM_ATIVO =
  "bg-sidebar-accent font-semibold text-sidebar-accent-foreground before:absolute before:inset-y-1 before:left-0 before:w-0.5 before:rounded-full before:bg-sidebar-primary before:content-['']";

function LinkNav({
  href,
  rotulo,
  icone: Icone,
  ativo,
  sub = false,
  onNavegar,
}: {
  href: string;
  rotulo: string;
  icone?: LucideIcon;
  ativo: boolean;
  /** Subitem: mesmo alvo de 48px, ícone menor (F3/F4). */
  sub?: boolean;
  onNavegar?: () => void;
}) {
  return (
    <Link
      href={href}
      aria-current={ativo ? "page" : undefined}
      onClick={onNavegar}
      className={cn(CLASSE_ITEM, ativo && CLASSE_ITEM_ATIVO)}
    >
      {Icone ? (
        <Icone
          aria-hidden
          className={cn("shrink-0", sub ? "size-3.5" : "size-4")}
        />
      ) : null}
      {rotulo}
    </Link>
  );
}

/**
 * Grupo sanfonado (F3). O gatilho é `<button>` (`AccordionTrigger`), não
 * `<Link>` — é o que mata o 404 de `/painel/configuracoes`, rota sem `page.tsx`.
 *
 * `key={pathname}` remonta a sanfona a cada navegação: o grupo da rota ativa
 * sempre reabre e o "fechei à mão" não persiste entre rotas (contrato §3).
 * `keepMounted` mantém o painel no DOM com `hidden` quando fechado — fora da
 * ordem de foco e da árvore de acessibilidade, mas com markup estável no SSR.
 */
function GrupoNav({
  item,
  subitens,
  pathname,
  raiz,
  onNavegar,
}: {
  item: ItemNav;
  subitens: SubItemNav[];
  pathname: string;
  raiz: string;
  onNavegar?: () => void;
}) {
  const Icone = item.icone;
  const dentro =
    estaAtivo(pathname, item.href, raiz) ||
    subitens.some((sub) => estaAtivo(pathname, sub.href, raiz));

  return (
    <Accordion
      key={pathname}
      defaultValue={dentro ? [item.href] : []}
      className="gap-1"
    >
      <AccordionItem value={item.href} className="not-last:border-b-0">
        <AccordionTrigger
          className={cn(
            CLASSE_ITEM,
            "items-center border-transparent hover:no-underline focus-visible:border-transparent",
          )}
        >
          <Icone aria-hidden className="size-4 shrink-0" />
          {item.rotulo}
        </AccordionTrigger>
        <AccordionContent
          keepMounted
          className="ml-7 flex flex-col gap-0.5 [&_a]:no-underline [&_a]:hover:text-sidebar-foreground"
        >
          {subitens.map((sub) => (
            <LinkNav
              key={sub.href}
              href={sub.href}
              rotulo={sub.rotulo}
              icone={sub.icone}
              sub
              ativo={estaAtivo(pathname, sub.href, raiz)}
              onNavegar={onNavegar}
            />
          ))}
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

/** Lista de navegação — fonte única para desktop e mobile. */
function ListaNav({
  contexto = {},
  onNavegar,
}: {
  contexto?: ContextoNav;
  onNavegar?: () => void;
}) {
  const pathname = usePathname();
  const itens = construirItens(contexto);
  const raiz = contexto.basePath ?? "/painel";

  return (
    // F8: os dois <nav> (desktop e Sheet) precisam de nome acessível próprio.
    <nav aria-label="Menu do painel" className="flex flex-1 flex-col gap-1">
      {itens.map((item) => {
        if (item.grupo && item.subitens) {
          return (
            <GrupoNav
              key={item.href}
              item={item}
              subitens={item.subitens}
              pathname={pathname}
              raiz={raiz}
              onNavegar={onNavegar}
            />
          );
        }

        // Pai com subitens: `estaAtivo` casa por prefixo, então uma sub-rota
        // (ex. /produtos/opcionais) também "ativaria" o pai /produtos. Só
        // suprime o destaque do pai quando um subitem específico é o match —
        // na própria rota do pai (sem subitem ativo), o pai acende normalmente.
        const subitemAtivo =
          item.subitens?.some((sub) => estaAtivo(pathname, sub.href, raiz)) ??
          false;
        const ativo = estaAtivo(pathname, item.href, raiz) && !subitemAtivo;
        return (
          <div key={item.href} className="flex flex-col gap-1">
            <LinkNav
              href={item.href}
              rotulo={item.rotulo}
              icone={item.icone}
              ativo={ativo}
              onNavegar={onNavegar}
            />
            {item.subitens ? (
              <div className="ml-7 flex flex-col gap-0.5">
                {item.subitens.map((sub) => (
                  <LinkNav
                    key={sub.href}
                    href={sub.href}
                    rotulo={sub.rotulo}
                    icone={sub.icone}
                    sub
                    ativo={estaAtivo(pathname, sub.href, raiz)}
                    onNavegar={onNavegar}
                  />
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </nav>
  );
}

function BotaoLogout() {
  const router = useRouter();
  const [saindo, setSaindo] = useState(false);

  async function sair() {
    setSaindo(true);
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
    } catch (e) {
      // Erro interno nunca vaza ao cliente (§14): só log no console.
      console.error("[logout]", e);
    } finally {
      router.push("/login");
      router.refresh();
    }
  }

  return (
    <Button
      variant="ghost"
      onClick={sair}
      disabled={saindo}
      className="w-full justify-start gap-3 px-3 py-2.5 text-sidebar-foreground/70 hover:text-sidebar-foreground"
    >
      <LogOut aria-hidden className="size-4 shrink-0" />
      Sair
    </Button>
  );
}

/**
 * Identidade da loja no topo do shell (F1/F2). Sem `nomeLoja` cai no `titulo`
 * (default `iRango`) — é o caso do hub admin, onde nome e status vivem na faixa
 * persistente da coluna de conteúdo (issue 145), não aqui.
 *
 * O logo é a ÚNICA marca da loja no shell: nenhuma cor vem de `lojas.tema`.
 */
function IdentidadeLoja({ contexto }: { contexto: ContextoNav }) {
  const { nome, temStatus } = identidadeLoja(contexto);
  const logo = fotoSegura(contexto.logoUrl);

  return (
    <div className="flex items-center gap-3 px-3 py-3">
      {logo ? (
        <Image
          src={logo}
          alt=""
          width={32}
          height={32}
          unoptimized
          className="size-8 shrink-0 rounded-full object-cover"
        />
      ) : null}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate font-heading text-base font-semibold text-sidebar-foreground">
            {nome}
          </span>
          {contexto.slugLoja ? (
            <Link
              href={`/loja/${contexto.slugLoja}`}
              target="_blank"
              rel="noopener noreferrer"
              title="Ver vitrine"
              aria-label={`Ver vitrine de ${nome} (abre em nova aba)`}
              className="shrink-0 rounded p-1.5 text-sidebar-foreground/60 outline-none transition-colors hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:ring-offset-2"
            >
              <ExternalLink aria-hidden className="size-3.5" />
            </Link>
          ) : null}
        </div>
        {temStatus ? (
          <div className="mt-1">
            <BadgeStatus
              horarios={contexto.horarios!}
              timezone={contexto.timezone!}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Rodapé: conta logada (F10), link de volta opcional e "Sair". O link de volta
 * é condicionado por `voltarHref` — dado PASSADO pelo layout, nunca inferido do
 * `basePath`: regra de roteamento não mora em componente de apresentação.
 */
function RodapeSidebar({
  contexto,
  onNavegar,
}: {
  contexto: ContextoNav;
  onNavegar?: () => void;
}) {
  return (
    <div className="flex flex-col gap-1 px-2 py-2">
      {contexto.emailConta ? (
        <p
          title={contexto.emailConta}
          className="truncate px-3 text-xs text-sidebar-foreground/60"
        >
          {contexto.emailConta}
        </p>
      ) : null}
      {contexto.voltarHref ? (
        <>
          <Link
            href={contexto.voltarHref}
            onClick={onNavegar}
            className={CLASSE_ITEM}
          >
            <ArrowLeft aria-hidden className="size-4 shrink-0" />
            {contexto.voltarRotulo ?? "Voltar"}
          </Link>
          <Separator className="my-1" />
        </>
      ) : null}
      <BotaoLogout />
    </div>
  );
}

function ConteudoSidebar({
  contexto = {},
  onNavegar,
}: {
  contexto?: ContextoNav;
  onNavegar?: () => void;
}) {
  return (
    <>
      <IdentidadeLoja contexto={contexto} />
      <Separator />
      <div className="flex flex-1 flex-col overflow-y-auto px-2 py-2">
        <ListaNav contexto={contexto} onNavegar={onNavegar} />
      </div>
      <Separator />
      <RodapeSidebar contexto={contexto} onNavegar={onNavegar} />
    </>
  );
}

/** Sidebar fixa do desktop (≥1024px). */
export function SidebarPainel({ contexto = {} }: { contexto?: ContextoNav }) {
  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:flex">
      <ConteudoSidebar contexto={contexto} />
    </aside>
  );
}

/** Topbar do mobile (<1024px): hamburger abre a sidebar como Sheet. */
export function TopbarPainel({ contexto = {} }: { contexto?: ContextoNav }) {
  const [aberto, setAberto] = useState(false);
  const { nome, temStatus } = identidadeLoja(contexto);

  return (
    <header className="flex h-14 items-center gap-2 border-b border-sidebar-border bg-sidebar px-4 text-sidebar-foreground lg:hidden">
      <Sheet open={aberto} onOpenChange={setAberto}>
        <SheetTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              aria-label="Abrir menu"
              className="size-11"
            />
          }
        >
          <Menu aria-hidden className="size-5" />
        </SheetTrigger>
        <SheetContent
          side="left"
          className="flex w-72 flex-col gap-0 bg-sidebar p-0 text-sidebar-foreground"
        >
          <SheetHeader className="p-0">
            {/* Nome acessível do diálogo: o título VISÍVEL é a identidade da
                loja, que não serve de rótulo do menu no hub admin. */}
            <SheetTitle className="sr-only">Menu do painel</SheetTitle>
            <IdentidadeLoja contexto={contexto} />
          </SheetHeader>
          <Separator />
          <div className="flex flex-1 flex-col overflow-y-auto px-2 py-2">
            <ListaNav contexto={contexto} onNavegar={() => setAberto(false)} />
          </div>
          <Separator />
          <RodapeSidebar
            contexto={contexto}
            onNavegar={() => setAberto(false)}
          />
        </SheetContent>
      </Sheet>
      {/* F12: a topbar mostra QUAL loja está sendo gerenciada e o status. */}
      <span className="min-w-0 truncate font-heading text-base font-semibold">
        {nome}
      </span>
      {temStatus ? (
        <div className="ml-auto shrink-0">
          <BadgeStatus
            horarios={contexto.horarios!}
            timezone={contexto.timezone!}
          />
        </div>
      ) : null}
    </header>
  );
}

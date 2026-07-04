"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  ClipboardList,
  Package,
  Ticket,
  Settings,
  LogOut,
  Menu,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { createClient } from "@/lib/supabase/client";

type ItemNav = {
  href: string;
  rotulo: string;
  icone: LucideIcon;
  /** Subitens de Configurações (sub-rotas exatas). */
  subitens?: { href: string; rotulo: string }[];
};

/**
 * Contexto que parametriza o shell de navegação. TODO opcional → o default
 * (`{}`) reproduz o painel do lojista byte-a-byte (`/painel`, Assinatura
 * visível, Configurações com subitens). Só primitivos: os ícones (`LucideIcon`)
 * NUNCA cruzam a fronteira RSC→client — são resolvidos aqui dentro, no módulo
 * `'use client'`, por `construirItens`.
 */
export type ContextoNav = {
  /** Raiz das rotas do menu. Default `/painel`. */
  basePath?: string;
  /** Título exibido no topo do menu. Default `iRango`. */
  titulo?: string;
  /** Admin: `true` remove o subitem Assinatura (organização, não segurança). */
  ocultarAssinatura?: boolean;
  /** Admin: `true` deixa Configurações sem subitens (item consolidado). */
  configConsolidada?: boolean;
};

/**
 * Gera os itens do menu a partir do `basePath`, reescrevendo hrefs relativos à
 * base e mantendo ordem/ícones/rótulos idênticos. Helper puro DENTRO do módulo
 * client (ícones não cruzam a fronteira RSC). Sem contexto → itens do lojista.
 */
function construirItens(contexto: ContextoNav = {}): ItemNav[] {
  const base = contexto.basePath ?? "/painel";

  const itemConfiguracoes: ItemNav = contexto.configConsolidada
    ? { href: `${base}/configuracoes`, rotulo: "Configurações", icone: Settings }
    : {
        href: `${base}/configuracoes`,
        rotulo: "Configurações",
        icone: Settings,
        subitens: [
          { href: `${base}/configuracoes/perfil`, rotulo: "Perfil" },
          { href: `${base}/configuracoes/horarios`, rotulo: "Horários" },
          { href: `${base}/configuracoes/entregas`, rotulo: "Entregas" },
          { href: `${base}/configuracoes/pagamentos`, rotulo: "Pagamentos" },
          { href: `${base}/configuracoes/tema`, rotulo: "Tema" },
          ...(contexto.ocultarAssinatura
            ? []
            : [
                {
                  href: `${base}/configuracoes/assinatura`,
                  rotulo: "Assinatura",
                },
              ]),
        ],
      };

  return [
    { href: base, rotulo: "Dashboard", icone: LayoutDashboard },
    { href: `${base}/pedidos`, rotulo: "Pedidos", icone: ClipboardList },
    {
      href: `${base}/produtos`,
      rotulo: "Produtos",
      icone: Package,
      subitens: [{ href: `${base}/produtos/opcionais`, rotulo: "Opcionais" }],
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

function LinkNav({
  href,
  rotulo,
  icone: Icone,
  ativo,
  onNavegar,
}: {
  href: string;
  rotulo: string;
  icone?: LucideIcon;
  ativo: boolean;
  onNavegar?: () => void;
}) {
  return (
    <Link
      href={href}
      aria-current={ativo ? "page" : undefined}
      onClick={onNavegar}
      className={cn(
        "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
        ativo &&
          "border-l-2 border-primary bg-accent font-semibold text-foreground",
      )}
    >
      {Icone ? <Icone aria-hidden className="size-4 shrink-0" /> : null}
      {rotulo}
    </Link>
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
    <nav className="flex flex-1 flex-col gap-1">
      {itens.map((item) => {
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
      className="w-full justify-start gap-3 px-3 text-muted-foreground hover:text-foreground"
    >
      <LogOut aria-hidden className="size-4 shrink-0" />
      Sair
    </Button>
  );
}

function ConteudoSidebar({
  contexto = {},
  onNavegar,
}: {
  contexto?: ContextoNav;
  onNavegar?: () => void;
}) {
  const titulo = contexto.titulo ?? "iRango";
  return (
    <>
      <div className="px-3 py-2 text-lg font-semibold">{titulo}</div>
      <Separator />
      <div className="flex flex-1 flex-col px-2 py-2">
        <ListaNav contexto={contexto} onNavegar={onNavegar} />
      </div>
      <Separator />
      <div className="px-2 py-2">
        <BotaoLogout />
      </div>
    </>
  );
}

/** Sidebar fixa do desktop (≥1024px). */
export function SidebarPainel({ contexto = {} }: { contexto?: ContextoNav }) {
  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r bg-card lg:flex">
      <ConteudoSidebar contexto={contexto} />
    </aside>
  );
}

/** Topbar do mobile (<1024px): hamburger abre a sidebar como Sheet. */
export function TopbarPainel({ contexto = {} }: { contexto?: ContextoNav }) {
  const [aberto, setAberto] = useState(false);
  const titulo = contexto.titulo ?? "iRango";

  return (
    <header className="flex h-14 items-center gap-2 border-b bg-card px-4 lg:hidden">
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
        <SheetContent side="left" className="flex w-72 flex-col gap-0 p-0">
          <SheetHeader className="px-3 py-3">
            <SheetTitle className="text-lg">{titulo}</SheetTitle>
          </SheetHeader>
          <Separator />
          <div className="flex flex-1 flex-col px-2 py-2">
            <ListaNav contexto={contexto} onNavegar={() => setAberto(false)} />
          </div>
          <Separator />
          <div className="px-2 py-2">
            <BotaoLogout />
          </div>
        </SheetContent>
      </Sheet>
      <span className="text-base font-semibold">{titulo}</span>
    </header>
  );
}

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

const ITENS: ItemNav[] = [
  { href: "/painel", rotulo: "Dashboard", icone: LayoutDashboard },
  { href: "/painel/pedidos", rotulo: "Pedidos", icone: ClipboardList },
  {
    href: "/painel/produtos",
    rotulo: "Produtos",
    icone: Package,
    subitens: [{ href: "/painel/produtos/opcionais", rotulo: "Opcionais" }],
  },
  { href: "/painel/cupons", rotulo: "Cupons", icone: Ticket },
  {
    href: "/painel/configuracoes",
    rotulo: "Configurações",
    icone: Settings,
    subitens: [
      { href: "/painel/configuracoes/perfil", rotulo: "Perfil" },
      { href: "/painel/configuracoes/horarios", rotulo: "Horários" },
      { href: "/painel/configuracoes/entregas", rotulo: "Entregas" },
      { href: "/painel/configuracoes/pagamentos", rotulo: "Pagamentos" },
      { href: "/painel/configuracoes/tema", rotulo: "Tema" },
      { href: "/painel/configuracoes/assinatura", rotulo: "Assinatura" },
    ],
  },
];

/**
 * `/painel` é prefixo de tudo — só está ativo em correspondência exata.
 * Demais itens ativam por prefixo (cobre sub-rotas como /pedidos/[id]).
 */
function estaAtivo(pathname: string, href: string): boolean {
  if (href === "/painel") return pathname === "/painel";
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
function ListaNav({ onNavegar }: { onNavegar?: () => void }) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-1 flex-col gap-1">
      {ITENS.map((item) => {
        const ativo = estaAtivo(pathname, item.href);
        return (
          <div key={item.href} className="flex flex-col gap-1">
            <LinkNav
              href={item.href}
              rotulo={item.rotulo}
              icone={item.icone}
              ativo={item.subitens ? false : ativo}
              onNavegar={onNavegar}
            />
            {item.subitens ? (
              <div className="ml-7 flex flex-col gap-0.5">
                {item.subitens.map((sub) => (
                  <LinkNav
                    key={sub.href}
                    href={sub.href}
                    rotulo={sub.rotulo}
                    ativo={estaAtivo(pathname, sub.href)}
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

function ConteudoSidebar({ onNavegar }: { onNavegar?: () => void }) {
  return (
    <>
      <div className="px-3 py-2 text-lg font-semibold">iRango</div>
      <Separator />
      <div className="flex flex-1 flex-col px-2 py-2">
        <ListaNav onNavegar={onNavegar} />
      </div>
      <Separator />
      <div className="px-2 py-2">
        <BotaoLogout />
      </div>
    </>
  );
}

/** Sidebar fixa do desktop (≥1024px). */
export function SidebarPainel() {
  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r bg-card lg:flex">
      <ConteudoSidebar />
    </aside>
  );
}

/** Topbar do mobile (<1024px): hamburger abre a sidebar como Sheet. */
export function TopbarPainel() {
  const [aberto, setAberto] = useState(false);

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
            <SheetTitle className="text-lg">iRango</SheetTitle>
          </SheetHeader>
          <Separator />
          <div className="flex flex-1 flex-col px-2 py-2">
            <ListaNav onNavegar={() => setAberto(false)} />
          </div>
          <Separator />
          <div className="px-2 py-2">
            <BotaoLogout />
          </div>
        </SheetContent>
      </Sheet>
      <span className="text-base font-semibold">iRango</span>
    </header>
  );
}

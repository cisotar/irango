"use client";

import { useEffect } from "react";
import Link from "next/link";
import { ChevronRight, Menu, X } from "lucide-react";

import { BotaoSair } from "@/components/cliente/BotaoSair";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { nextDaLoja } from "@/components/vitrine/checkout/linkEntrar";
import { marcarDispensa, sessionStorageSeguro } from "@/components/vitrine/decisaoGavetaConta";
import { ID_MAIN_VITRINE } from "@/components/vitrine/layoutVitrine";
import { itensMenuCliente } from "@/components/vitrine/menuCliente";
import { OpcoesConta } from "@/components/vitrine/OpcoesConta";
import {
  abrirGavetaConta,
  fecharGavetaConta,
  useGavetaConta,
  zerarGavetaConta,
} from "@/hooks/useGavetaConta";

/**
 * Menu da conta no topo esquerdo da vitrine. Gaveta lateral aberta pelo ☰ ou
 * pelo "Finalizar pedido" do carrinho (sem login); fecha no X, ESC, toque fora
 * ou ao escolher um link. Recebe só o booleano da sessão: nenhum nome ou
 * e-mail entra no HTML público.
 */
export function MenuCliente({ lojaSlug, logado }: { lojaSlug: string; logado: boolean }) {
  const { aberta, origem } = useGavetaConta();
  const pelaFinalizacao = origem === "finalizar";
  // Pelo "Finalizar pedido", entrar ou criar conta volta para o checkout.
  const next = nextDaLoja(lojaSlug, pelaFinalizacao ? "/pedido" : "");

  useEffect(() => zerarGavetaConta, []);

  return (
    <Sheet
      open={aberta}
      onOpenChange={(abrir) => (abrir ? abrirGavetaConta("menu") : fecharGavetaConta())}
    >
      <SheetTrigger
        aria-label="Abrir menu da conta"
        className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-white hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-white"
      >
        <Menu aria-hidden className="size-6" />
      </SheetTrigger>
      {/* O ✕ do shadcn é `icon-sm` (abaixo de 44px) e rotulado "Close":
          desligado, com um próprio de 44×44 — mesmo padrão do ModalPromocoes.
          Aberta pelo carrinho, o "Finalizar pedido" some com a gaveta do
          carrinho: o foco volta ao `<main>`, não ao ☰. */}
      <SheetContent
        side="left"
        className="gap-0 overflow-y-auto"
        showCloseButton={false}
        finalFocus={pelaFinalizacao ? () => document.getElementById(ID_MAIN_VITRINE) : true}
      >
        <SheetClose
          aria-label="Fechar"
          className="absolute top-2 right-2 inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-texto-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X aria-hidden className="size-5" />
        </SheetClose>
        <SheetHeader className="pr-14">
          <SheetTitle>Sua conta</SheetTitle>
        </SheetHeader>
        <div className="flex flex-col px-4 pb-6">
          {logado ? (
            <>
              <nav aria-label="Conta do cliente">
                <ul className="flex flex-col">
                  {itensMenuCliente(lojaSlug).map((item) => (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={fecharGavetaConta}
                        className="flex min-h-[44px] items-center justify-between rounded-md px-2 text-base font-medium text-texto hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {item.rotulo}
                        <ChevronRight aria-hidden className="size-4 text-texto-muted" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>
              <Separator className="my-3" />
              <BotaoSair next={nextDaLoja(lojaSlug)} className="justify-start px-2 text-base" />
            </>
          ) : (
            <>
              <OpcoesConta next={next} />
              {pelaFinalizacao && (
                <Link
                  href={`/loja/${lojaSlug}/pedido`}
                  onClick={() => {
                    marcarDispensa(sessionStorageSeguro(), lojaSlug);
                    fecharGavetaConta();
                  }}
                  className="mx-auto mt-4 inline-flex min-h-[44px] items-center px-2 text-sm font-semibold text-texto underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Prosseguir sem login
                </Link>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

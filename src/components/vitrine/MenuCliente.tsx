"use client";

import { useState } from "react";
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
import { itensMenuCliente } from "@/components/vitrine/menuCliente";
import { OpcoesConta } from "@/components/vitrine/OpcoesConta";

/**
 * Menu da conta no topo esquerdo da vitrine. Gaveta lateral que abre no botão
 * e fecha no X, ESC, toque fora ou ao escolher um link. Recebe só o booleano
 * da sessão: nenhum nome ou e-mail entra no HTML público.
 */
export function MenuCliente({ lojaSlug, logado }: { lojaSlug: string; logado: boolean }) {
  const [aberto, setAberto] = useState(false);
  const next = nextDaLoja(lojaSlug);

  return (
    <Sheet open={aberto} onOpenChange={setAberto}>
      <SheetTrigger
        aria-label="Abrir menu da conta"
        className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-white hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-white"
      >
        <Menu aria-hidden className="size-6" />
      </SheetTrigger>
      {/* O ✕ do shadcn é `icon-sm` (abaixo de 44px) e rotulado "Close":
          desligado, com um próprio de 44×44 — mesmo padrão do ModalPromocoes. */}
      <SheetContent side="left" className="gap-0 overflow-y-auto" showCloseButton={false}>
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
                        onClick={() => setAberto(false)}
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
              <BotaoSair next={next} className="justify-start px-2 text-base" />
            </>
          ) : (
            <OpcoesConta next={next} />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

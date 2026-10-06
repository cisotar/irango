"use client";

// Moldura de /minha-conta/* (página única e páginas dedicadas): kebab fixo no
// canto superior esquerdo, navegação lateral e o conteúdo como container.
// - PC (≥ lg): `<aside>` fixed colado na borda, aberto por padrão; o kebab
//   fecha e o conteúdo recupera a largura.
// - Mobile (< lg): gaveta `Sheet` (foco preso, Esc, clique fora), fechada por
//   padrão.
// O padrão "aberta no PC, fechada no mobile" é só CSS por breakpoint (cada
// kebab e o `<aside>` existem só no seu breakpoint): nada depende de JS depois
// do mount, então não há flash. A lista de itens vem de `SECOES_CONTA` e o
// conteúdo da lateral é um único componente nos dois containers.
import { useEffect, useRef, useState, type ComponentProps, type MouseEvent, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { EllipsisVertical } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetClose, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { BotaoSair } from "@/components/cliente/BotaoSair";
import { sanitizarNext } from "@/lib/utils/sanitizarNext";
import { cn } from "@/lib/utils";
import { ExcluirConta } from "./ExcluirConta";
import {
  ROTA_MINHA_CONTA,
  SECOES_CONTA,
  hrefSecao,
  secaoAtiva,
  secaoDaRota,
  type IdSecaoConta,
} from "./secoesConta";

const ID_LATERAL = "lateral-conta";
const ID_GAVETA = "gaveta-conta";
const MIDIA_PC = "(min-width: 64rem)"; // breakpoint `lg` do Tailwind
/** Linha de leitura do destaque: 30% da altura da janela. */
const LINHA_LEITURA = 0.3;

function rolarAte(id: IdSecaoConta) {
  const alvo = document.getElementById(id);
  if (!alvo) return;
  const reduzir = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  alvo.scrollIntoView({ behavior: reduzir ? "auto" : "smooth", block: "start" });
  // Como um link de âncora nativo: o próximo Tab parte da seção.
  alvo.focus({ preventScroll: true });
}

/** Clique simples (sem modificador): os demais abrem em nova aba como link normal. */
function cliqueSimples(e: MouseEvent<HTMLAnchorElement>) {
  return !e.defaultPrevented && e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
}

function BotaoKebab({
  aberta,
  controla,
  className,
  ...props
}: ComponentProps<typeof Button> & { aberta: boolean; controla: string }) {
  return (
    <Button
      type="button"
      variant="outline"
      aria-expanded={aberta}
      aria-controls={controla}
      aria-label={aberta ? "Fechar menu da conta" : "Abrir menu da conta"}
      className={cn("size-11 bg-card shadow-xs", className)}
      {...props}
    >
      <EllipsisVertical className="size-5" aria-hidden="true" />
    </Button>
  );
}

function ConteudoLateral({
  email,
  soPerfil,
  next,
  ativa,
  aoClicar,
}: {
  email: string;
  soPerfil: boolean;
  next: string | undefined;
  ativa: IdSecaoConta | null;
  aoClicar: (e: MouseEvent<HTMLAnchorElement>, id: IdSecaoConta) => void;
}) {
  return (
    <div className="flex flex-1 flex-col gap-3 p-3">
      <div className="px-3">
        <p className="text-base font-semibold text-primaria">🥖 iRango</p>
        <p className="text-sm break-all text-texto-muted">{email}</p>
      </div>
      <Separator />
      <nav aria-label="Seções da conta">
        <ul className="flex flex-col gap-1">
          {SECOES_CONTA.map(({ id, rotulo, Icone }) => (
            <li key={id}>
              <Link
                href={hrefSecao(id, next)}
                aria-current={ativa === id ? "true" : undefined}
                onClick={(e) => aoClicar(e, id)}
                className="flex min-h-11 items-center gap-2.5 rounded-md px-3 text-sm text-texto hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none aria-[current=true]:bg-muted aria-[current=true]:font-semibold aria-[current=true]:shadow-[inset_3px_0_0_var(--color-primaria)]"
              >
                <Icone className="size-4 shrink-0" aria-hidden="true" />
                {rotulo}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <Separator />
      <BotaoSair next={next} icone className="w-full justify-start px-3 text-texto-muted" />

      {/* Zona de risco: rodapé da lateral, separada das seções. */}
      <div className="mt-auto flex flex-col gap-3 pt-3">
        <Separator />
        <ExcluirConta soPerfil={soPerfil} />
      </div>
    </div>
  );
}

export function ShellConta({
  email,
  soPerfil,
  children,
}: {
  email: string;
  soPerfil: boolean;
  children: ReactNode;
}) {
  const pathname = usePathname();
  // Mesmo `next` que as páginas leem (o layout não recebe searchParams):
  // sanitizado aqui e de novo por quem o consome (página, action de sair).
  const next = sanitizarNext(useSearchParams()?.get("next"));
  const paginaUnica = pathname === ROTA_MINHA_CONTA;

  const [lateralAberta, setLateralAberta] = useState(true); // PC
  const [gavetaAberta, setGavetaAberta] = useState(false); // mobile
  const [ativaPorScroll, setAtivaPorScroll] = useState<IdSecaoConta | null>(null);
  // Seção a rolar quando a gaveta terminar de fechar (o scroll lock do Sheet
  // segura a página enquanto ela está aberta).
  const destinoPendente = useRef<IdSecaoConta | null>(null);

  const ativa = paginaUnica ? (ativaPorScroll ?? SECOES_CONTA[0].id) : secaoDaRota(pathname);

  // Destaque da seção visível na página única.
  useEffect(() => {
    if (!paginaUnica) return;
    let quadro = 0;
    const atualizar = () => {
      const topos = SECOES_CONTA.map(({ id }) => ({
        id,
        topo: document.getElementById(id)?.getBoundingClientRect().top ?? Infinity,
      }));
      const raiz = document.documentElement;
      const noFim = window.scrollY > 0 && window.innerHeight + window.scrollY >= raiz.scrollHeight - 2;
      setAtivaPorScroll(secaoAtiva(topos, window.innerHeight * LINHA_LEITURA, noFim));
    };
    const agendar = () => {
      cancelAnimationFrame(quadro);
      quadro = requestAnimationFrame(atualizar);
    };
    agendar();
    window.addEventListener("scroll", agendar, { passive: true });
    window.addEventListener("resize", agendar);
    return () => {
      cancelAnimationFrame(quadro);
      window.removeEventListener("scroll", agendar);
      window.removeEventListener("resize", agendar);
    };
  }, [paginaUnica]);

  // Janela passou para PC com a gaveta aberta: fecha (no PC vale o `<aside>`).
  useEffect(() => {
    const midia = window.matchMedia(MIDIA_PC);
    const aoMudar = (e: MediaQueryListEvent) => {
      if (e.matches) setGavetaAberta(false);
    };
    midia.addEventListener("change", aoMudar);
    return () => midia.removeEventListener("change", aoMudar);
  }, []);

  function aoClicar(e: MouseEvent<HTMLAnchorElement>, id: IdSecaoConta, naGaveta: boolean) {
    if (!cliqueSimples(e)) return;
    if (!paginaUnica) {
      // Página dedicada: o Link navega até /minha-conta#<id>; a gaveta fecha.
      if (naGaveta) setGavetaAberta(false);
      return;
    }
    e.preventDefault();
    // Âncora na URL sem recarregar (o Next sincroniza o history nativo).
    window.history.replaceState(null, "", `#${id}`);
    setAtivaPorScroll(id);
    if (naGaveta) {
      destinoPendente.current = id;
      setGavetaAberta(false);
    } else {
      rolarAte(id);
    }
  }

  const props = { email, soPerfil, next, ativa };

  return (
    <>
      <BotaoKebab
        aberta={lateralAberta}
        controla={ID_LATERAL}
        className="fixed top-3 left-3 z-40 hidden lg:inline-flex"
        onClick={() => setLateralAberta((v) => !v)}
      />
      <BotaoKebab
        aberta={gavetaAberta}
        controla={ID_GAVETA}
        className="fixed top-3 left-3 z-40 lg:hidden"
        onClick={() => {
          // Destino de um fechamento anterior que não completou não vale mais.
          destinoPendente.current = null;
          setGavetaAberta(true);
        }}
      />

      <aside
        id={ID_LATERAL}
        aria-label="Menu da conta"
        className={cn(
          "fixed inset-y-0 left-0 z-30 hidden w-64 flex-col overflow-y-auto border-r border-border bg-card pt-14 shadow-xs",
          lateralAberta && "lg:flex",
        )}
      >
        <ConteudoLateral {...props} aoClicar={(e, id) => aoClicar(e, id, false)} />
      </aside>

      <Sheet
        open={gavetaAberta}
        onOpenChange={(aberta) => setGavetaAberta(aberta)}
        onOpenChangeComplete={(aberta) => {
          const id = destinoPendente.current;
          if (aberta || !id) return;
          destinoPendente.current = null;
          rolarAte(id);
        }}
      >
        <SheetContent
          id={ID_GAVETA}
          side="left"
          showCloseButton={false}
          // Fechou por um link: o foco vai para a seção (em `rolarAte`), não
          // de volta ao kebab.
          finalFocus={() => destinoPendente.current === null}
          className="gap-0 overflow-y-auto bg-card pt-14 text-texto data-[side=left]:w-66"
        >
          <SheetTitle className="sr-only">Menu da conta</SheetTitle>
          {/* O mesmo kebab, na mesma posição, fecha a gaveta (o de fora fica
              sob o backdrop enquanto ela está aberta). */}
          <SheetClose
            render={<BotaoKebab aberta controla={ID_GAVETA} className="absolute top-3 left-3" />}
          />
          <ConteudoLateral {...props} aoClicar={(e, id) => aoClicar(e, id, true)} />
        </SheetContent>
      </Sheet>

      <main
        id="conteudo-conta"
        className={cn(
          "@container max-w-[82rem] min-w-0 px-4 pt-16 pb-10 transition-[padding] duration-200 ease-out motion-reduce:transition-none lg:pr-10",
          // Largura da lateral + respiro: os cards nunca encostam no painel.
          lateralAberta ? "lg:pl-[calc(16rem+2.5rem)]" : "lg:pl-10",
        )}
      >
        {children}
      </main>
    </>
  );
}

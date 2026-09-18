"use client";

import { Minus, Plus } from "lucide-react";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatarMoeda } from "@/lib/utils/formatarMoeda";
import type { GrupoOpcional } from "@/lib/supabase/queries/produtos";
import {
  contarEscolhidosDoGrupo,
  rotuloGrupoOpcional,
  type QtdPorOpcional,
} from "./escolhasOpcionais";

type SecaoOpcionaisProps = {
  /** Grupos JÁ ordenados pelo servidor (`categoria_produto_opcionais.ordem`). O cliente não reordena. */
  grupos: GrupoOpcional[];
  qtdOpcionais: QtdPorOpcional;
  onAjustar: (opcionalId: string, delta: number) => void;
};

/**
 * Miolo da seção "Opcionais" do `ProdutoModal` (issue 210). Extraído para ficar
 * testável sem jsdom: o `Dialog` (base-ui) usa portal e não renderiza em SSR, então
 * `renderToStaticMarkup(<ProdutoModal/>)` devolve string vazia.
 *
 * Ramifica pelo limiar LITERAL `grupos.length > 1` (Decisão D-3):
 *  - 2+ grupos → cada grupo é um item de sanfona, 1º aberto e demais fechados,
 *    múltiplos podendo ficar abertos (`multiple`, Decisão D-2);
 *  - exatamente 1 grupo → lista plana EXATAMENTE como antes da 210 (o nome do grupo
 *    segue como rótulo simples, sem gatilho e sem clique extra);
 *  - 0 grupos → nada (o caller já não monta a seção).
 *
 * Recolher um grupo NÃO limpa quantidade (RN-9): o estado é `qtdOpcionais`, do modal,
 * e `achatarOpcionaisEscolhidos` varre os GRUPOS, não a tela. Todo preço aqui é
 * PREVIEW — o servidor recalcula do banco no checkout (seguranca.md §10).
 */
export function SecaoOpcionais({
  grupos,
  qtdOpcionais,
  onAjustar,
}: SecaoOpcionaisProps) {
  if (grupos.length === 0) return null;

  return (
    <div className="rounded-2xl border border-[#eeeeee] bg-[#f9f9f9] p-4">
      <p className="mb-1 text-xs font-bold uppercase tracking-wide text-marrom-cafe">
        Opcionais
      </p>

      {grupos.length > 1 ? (
        <Accordion
          multiple
          defaultValue={[grupos[0].categoriaOpcionalId]}
          className="mt-1 gap-0"
        >
          {grupos.map((grupo) => {
            const escolhidos = contarEscolhidosDoGrupo(grupo, qtdOpcionais);
            return (
              <AccordionItem
                key={grupo.categoriaOpcionalId}
                value={grupo.categoriaOpcionalId}
                className="border-t border-[#eeeeee] not-last:border-b-0 first:border-t-0"
              >
                <AccordionTrigger
                  aria-label={rotuloGrupoOpcional(
                    grupo.categoriaOpcionalNome,
                    escolhidos,
                  )}
                  className="min-h-[44px] items-center gap-2 py-3 text-[0.7rem] font-bold uppercase tracking-wide text-[var(--texto-muted)] hover:no-underline"
                >
                  <span className="min-w-0 flex-1 truncate text-left">
                    {grupo.categoriaOpcionalNome}
                  </span>
                  {escolhidos > 0 ? (
                    <Badge
                      aria-hidden
                      className="bg-[var(--cor-destaque)] text-white tabular-nums"
                    >
                      {escolhidos}
                    </Badge>
                  ) : null}
                </AccordionTrigger>
                <AccordionContent className="pt-0 pb-2">
                  {grupo.opcionais.map((opcional) => (
                    <LinhaOpcional
                      key={opcional.id}
                      opcional={opcional}
                      qtd={qtdOpcionais[opcional.id] ?? 0}
                      onAjustar={onAjustar}
                    />
                  ))}
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      ) : (
        grupos.map((grupo) => (
          <div key={grupo.categoriaOpcionalId} className="mt-3 first:mt-1">
            <p className="border-t border-[#eeeeee] pt-3 text-[0.7rem] font-bold uppercase tracking-wide text-[var(--texto-muted)] first:border-t-0 first:pt-0">
              {grupo.categoriaOpcionalNome}
            </p>
            {grupo.opcionais.map((opcional) => (
              <LinhaOpcional
                key={opcional.id}
                opcional={opcional}
                qtd={qtdOpcionais[opcional.id] ?? 0}
                onAjustar={onAjustar}
              />
            ))}
          </div>
        ))
      )}
    </div>
  );
}

/**
 * Uma linha de opcional + mini-stepper `Minus`/`Plus` — markup INALTERADO desde a
 * issue 087 (design-claude/vitrine/produto-modal.html); só saiu do `.map()` inline
 * do modal para não ficar duplicado entre a lista plana e a sanfona.
 */
function LinhaOpcional({
  opcional,
  qtd,
  onAjustar,
}: {
  opcional: GrupoOpcional["opcionais"][number];
  qtd: number;
  onAjustar: (opcionalId: string, delta: number) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-[#eeeeee] py-2.5 last:border-b-0">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-[var(--texto)]">{opcional.nome}</p>
        <p className="mt-0.5 text-xs font-bold text-[var(--cor-destaque)]">
          + {formatarMoeda(opcional.preco)}
        </p>
      </div>
      <div
        role="group"
        aria-label={`Quantidade de ${opcional.nome}`}
        className="flex shrink-0 items-center overflow-hidden rounded-lg border-[1.5px] border-[#dccbb0] bg-white"
      >
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`Remover ${opcional.nome}`}
          disabled={qtd <= 0}
          onClick={() => onAjustar(opcional.id, -1)}
          className="size-7 rounded-none text-[var(--cor-destaque)]"
        >
          <Minus aria-hidden className="size-3.5" />
        </Button>
        <span
          role="status"
          aria-live="polite"
          aria-label={`${opcional.nome}: ${qtd}`}
          className="min-w-6 border-x border-[#dccbb0] px-0.5 text-center text-sm font-bold tabular-nums text-[var(--texto)]"
        >
          {qtd}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`Adicionar ${opcional.nome}`}
          onClick={() => onAjustar(opcional.id, 1)}
          className="size-7 rounded-none text-[var(--cor-destaque)]"
        >
          <Plus aria-hidden className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}

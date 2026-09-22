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
      <p className="mb-2 text-xs font-bold uppercase tracking-wide text-marrom-cafe">
        Opcionais
      </p>

      {grupos.length > 1 ? (
        <Accordion
          multiple
          defaultValue={[grupos[0].categoriaOpcionalId]}
          className="mt-1 gap-2"
        >
          {grupos.map((grupo) => {
            const escolhidos = contarEscolhidosDoGrupo(grupo, qtdOpcionais);
            return (
              <AccordionItem
                key={grupo.categoriaOpcionalId}
                value={grupo.categoriaOpcionalId}
                // Cada grupo é o PRÓPRIO cartão (branco, borda própria) em vez
                // de um item numa lista com filete — hoje o filete entre grupos
                // (#eeeeee sobre #f9f9f9) tem o MESMO peso do filete entre itens
                // dentro do grupo, e a hierarquia some com 2+ grupos abertos.
                // `data-open` (item aberto) marca a cor e o trilho de acento.
                className="relative overflow-hidden rounded-xl border-[1.5px] border-[#e5ddc9] bg-white not-last:border-b-0 before:absolute before:inset-y-0 before:left-0 before:w-0 before:bg-[var(--cor-destaque)] data-open:border-[var(--cor-destaque)] data-open:shadow-[0_2px_8px_rgba(45,58,39,0.12)] data-open:before:w-1"
              >
                <AccordionTrigger
                  aria-label={rotuloGrupoOpcional(
                    grupo.categoriaOpcionalNome,
                    escolhidos,
                  )}
                  // `sticky` no topo do corpo rolável (o ancestral rolável é o
                  // corpo do ProdutoModal): com 2+ grupos abertos e rolagem
                  // longa, o cabeçalho do grupo visível não sai da vista.
                  className="sticky top-0 z-10 min-h-[44px] items-center gap-2 rounded-none bg-white px-3 py-3 text-[0.7rem] font-bold uppercase tracking-wide text-[var(--texto-muted)] hover:no-underline data-panel-open:bg-[#f4f6f2]"
                >
                  <span className="min-w-0 flex-1 truncate text-left">
                    {grupo.categoriaOpcionalNome}
                  </span>
                  {escolhidos > 0 ? (
                    <Badge
                      aria-hidden
                      className="bg-[var(--cor-destaque)] text-white tabular-nums"
                    >
                      {escolhidos} {escolhidos > 1 ? "escolhidos" : "escolhido"}
                    </Badge>
                  ) : null}
                </AccordionTrigger>
                <AccordionContent className="px-3 pt-0 pb-2">
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
 * Uma linha de opcional + mini-stepper `Minus`/`Plus` (issue 087,
 * design-claude/vitrine/produto-modal.html); saiu do `.map()` inline do modal
 * para não ficar duplicado entre a lista plana e a sanfona.
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
        className="flex shrink-0 items-center rounded-[10px] border-[1.5px] border-[#dccbb0] bg-white"
      >
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`Remover ${opcional.nome}`}
          disabled={qtd <= 0}
          onClick={() => onAjustar(opcional.id, -1)}
          // Caixa visível 32px (`size-8` do variant); alvo de toque real 44px
          // via pseudo-elemento — hoje `size-7` dava 33,6px, abaixo do alvo
          // mínimo do design-system §5. Sem overflow-hidden no grupo (cortaria
          // o alvo estendido); os cantos externos ganham o raio do grupo.
          className="relative rounded-l-[8.5px] rounded-r-none text-[var(--cor-destaque)] after:absolute after:-inset-1.5 after:content-['']"
        >
          <Minus aria-hidden />
        </Button>
        <span
          role="status"
          aria-live="polite"
          aria-label={`${opcional.nome}: ${qtd}`}
          className="min-w-7 border-x-[1.5px] border-[#dccbb0] px-1 text-center text-sm font-bold tabular-nums text-[var(--texto)]"
        >
          {qtd}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`Adicionar ${opcional.nome}`}
          onClick={() => onAjustar(opcional.id, 1)}
          className="relative rounded-r-[8.5px] rounded-l-none text-[var(--cor-destaque)] after:absolute after:-inset-1.5 after:content-['']"
        >
          <Plus aria-hidden />
        </Button>
      </div>
    </div>
  );
}

"use client";

import { useState, type ReactElement } from "react";
import Image from "next/image";
import { ImageOff, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { fotoSegura } from "@/lib/utils/fotoSegura";
import {
  MSG_LISTAGEM_FALHOU,
  type CursorGaleria,
  type ImagemGaleria,
  type PaginaGaleria,
  type ResultadoListagemGaleria,
} from "@/lib/actions/galeria-contrato";

/** A régua de `design-system.md` §5: valor LITERAL, nunca `min-h-11`. */
const ALVO = "min-h-[44px] min-w-[44px]";

/**
 * Como a grade responde ao toque. Uma implementação só para os usos:
 *  - `nenhuma`  — só mostra (galeria fora do modo de seleção);
 *  - `multipla` — checkbox por item (modo "Selecionar" da galeria);
 *  - `unica`    — o toque escolhe a imagem (seletor do produto/logo).
 */
export type SelecaoGrade =
  | { modo: "nenhuma" }
  | {
      modo: "multipla";
      selecionadas: ReadonlySet<string>;
      onAlternar: (id: string) => void;
    }
  | { modo: "unica"; onEscolher: (imagem: ImagemGaleria) => void };

export type GradeImagensProps = {
  imagens: readonly ImagemGaleria[];
  /** Ids com selo "Em uso" (prévia do servidor). */
  emUso: ReadonlySet<string>;
  selecao: SelecaoGrade;
  /** Cursor da próxima página; `null` esconde o "Carregar mais". */
  proximoCursor: CursorGaleria | null;
  /**
   * Action do "Carregar mais" (keyset). Obrigatória, sem default: quem monta a
   * grade decide se é a do lojista ou a variante admin com `lojaId` fixado.
   */
  listarMais: (cursor: CursorGaleria) => Promise<ResultadoListagemGaleria>;
  /** Página seguinte já carregada; o dono da lista anexa e guarda o cursor. */
  onPaginaCarregada: (pagina: PaginaGaleria) => void;
  /** Ajuste de colunas de quem monta (o seletor usa 4 no desktop). */
  classeGrade?: string;
};

/** Miniatura quando houver; legada usa o próprio arquivo (P9). */
function Miniatura({ imagem, rotulo }: { imagem: ImagemGaleria; rotulo: string }) {
  const src = fotoSegura(imagem.miniatura_url ?? imagem.url);
  if (!src) {
    return (
      <div className="flex size-full items-center justify-center text-muted-foreground">
        <ImageOff aria-hidden className="size-6" />
        <span className="sr-only">{rotulo}</span>
      </div>
    );
  }
  return (
    <Image
      src={src}
      alt={rotulo}
      fill
      sizes="(min-width: 1024px) 160px, (min-width: 640px) 25vw, 33vw"
      unoptimized
      className="object-cover"
    />
  );
}

function SeloEmUso() {
  return (
    <Badge className="pointer-events-none absolute bottom-1.5 left-1.5 shadow-sm">
      Em uso
    </Badge>
  );
}

/**
 * Grade de miniaturas da galeria + "Carregar mais". Apresentação e paginação;
 * a lista, a seleção e o uso pertencem a quem monta a grade.
 */
export function GradeImagens({
  imagens,
  emUso,
  selecao,
  proximoCursor,
  listarMais,
  onPaginaCarregada,
  classeGrade,
}: GradeImagensProps): ReactElement {
  const [carregando, setCarregando] = useState(false);

  async function carregarMais(): Promise<void> {
    if (!proximoCursor || carregando) return;
    setCarregando(true);
    try {
      const r = await listarMais(proximoCursor);
      if (!r.ok) {
        toast.error(r.erro);
        return;
      }
      onPaginaCarregada({ imagens: r.imagens, proximo_cursor: r.proximo_cursor });
    } catch (e) {
      console.error("[GradeImagens] carregar mais", e);
      toast.error(MSG_LISTAGEM_FALHOU);
    } finally {
      setCarregando(false);
    }
  }

  const moldura =
    "relative block aspect-square w-full overflow-hidden rounded-md border border-border bg-muted";

  return (
    <div className="flex flex-col gap-4">
      <ul className={cn("grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6", classeGrade)}>
        {imagens.map((imagem, i) => {
          const rotulo = `Imagem ${i + 1} da galeria`;
          const usada = emUso.has(imagem.id);

          if (selecao.modo === "multipla") {
            const marcada = selecao.selecionadas.has(imagem.id);
            return (
              <li key={imagem.id}>
                {/* O alvo é o quadro inteiro (≥ 44px), não o quadradinho. */}
                <label
                  className={cn(
                    moldura,
                    "cursor-pointer outline-none",
                    marcada && "ring-3 ring-primary",
                  )}
                >
                  <Miniatura imagem={imagem} rotulo={rotulo} />
                  <span className="absolute top-0 left-0 flex min-h-[44px] min-w-[44px] items-center justify-center">
                    <Checkbox
                      checked={marcada}
                      onCheckedChange={() => selecao.onAlternar(imagem.id)}
                      aria-label={`Selecionar imagem ${i + 1}`}
                      className="bg-background shadow-sm"
                    />
                  </span>
                  {usada ? <SeloEmUso /> : null}
                </label>
              </li>
            );
          }

          if (selecao.modo === "unica") {
            return (
              <li key={imagem.id}>
                <button
                  type="button"
                  onClick={() => selecao.onEscolher(imagem)}
                  aria-label={`Escolher imagem ${i + 1}`}
                  className={cn(
                    moldura,
                    "outline-none focus-visible:ring-3 focus-visible:ring-ring",
                  )}
                >
                  <Miniatura imagem={imagem} rotulo="" />
                  {usada ? <SeloEmUso /> : null}
                </button>
              </li>
            );
          }

          return (
            <li key={imagem.id} className={moldura}>
              <Miniatura imagem={imagem} rotulo={rotulo} />
              {usada ? <SeloEmUso /> : null}
            </li>
          );
        })}
      </ul>

      {proximoCursor ? (
        <Button
          type="button"
          variant="outline"
          className={cn(ALVO, "self-center")}
          disabled={carregando}
          onClick={carregarMais}
        >
          {carregando ? <Loader2 aria-hidden className="animate-spin" /> : null}
          Carregar mais
        </Button>
      ) : null}
    </div>
  );
}

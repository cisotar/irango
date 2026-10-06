"use client";

import {
  Suspense,
  use,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type ReactElement,
} from "react";
import { ImagePlus, Loader2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { GradeImagens } from "@/components/painel/GradeImagens";
import { anexarPagina } from "@/components/painel/estadoGaleria";
import type { ListarGaleria } from "@/components/painel/fluxoRecorte";
import { CLASSE_DIALOG_TELA_CHEIA } from "@/components/shared/dialogTelaCheia";
import { cn } from "@/lib/utils";
import {
  MSG_LISTAGEM_FALHOU,
  type CursorGaleria,
  type ImagemGaleria,
  type ResultadoListagemGaleria,
} from "@/lib/actions/galeria-contrato";
import { TIPOS_IMAGEM_PERMITIDOS } from "@/lib/utils/validarImagem";

/** A régua de `design-system.md` §5: valor LITERAL, nunca `min-h-11`. */
const ALVO = "min-h-[44px] min-w-[44px]";

/** O seletor nunca mostra o selo "Em uso" (a prévia de uso é da página da galeria). */
const SEM_USO: ReadonlySet<string> = new Set();

export type SeletorGaleriaProps = {
  /** Controlado por quem abre: o seletor só fecha a si mesmo. */
  aberto: boolean;
  onAbertoChange: (aberto: boolean) => void;
  /**
   * 1ª página, pedida no CLIQUE que abre o seletor (`useSeletorGaleria`), não
   * num efeito: a leitura nasce do evento do lojista e o corpo só a consome.
   */
  primeiraPagina: LeituraPrimeiraPagina | null;
  /** "Tentar de novo" depois de uma falha: pede outra 1ª página. */
  onRecarregar: () => void;
  /** Action de listagem (lojista ou variante admin com `lojaId` fixado). */
  listar: ListarGaleria;
  /** Toque numa imagem: o seletor fecha e quem abriu leva a original ao cropper. */
  onEscolher: (imagem: ImagemGaleria) => void;
  /** Atalho "Enviar nova imagem": arquivo do aparelho, mesmo fluxo do "Enviar nova". */
  onArquivoEscolhido: (arquivo: File) => void;
};

/** Uma leitura da 1ª página; `versao` remonta a lista a cada leitura nova. */
export type LeituraPrimeiraPagina = {
  promessa: Promise<ResultadoListagemGaleria>;
  versao: number;
};

/** A action nunca lança para o corpo: exceção vira o erro genérico de listagem. */
async function listarSemLancar(listar: ListarGaleria): Promise<ResultadoListagemGaleria> {
  try {
    return await listar();
  } catch (e) {
    console.error("[SeletorGaleria] listar", e);
    return { ok: false, erro: MSG_LISTAGEM_FALHOU };
  }
}

/**
 * Estado do seletor para quem o abre. `abrir` é chamado no clique de
 * "Escolher da galeria" e já dispara a leitura da 1ª página.
 */
export function useSeletorGaleria(listar: ListarGaleria): {
  abrir: () => void;
  props: Pick<
    SeletorGaleriaProps,
    "aberto" | "onAbertoChange" | "primeiraPagina" | "onRecarregar" | "listar"
  >;
} {
  const [aberto, setAberto] = useState(false);
  const [primeiraPagina, setPrimeiraPagina] = useState<LeituraPrimeiraPagina | null>(null);

  function recarregar(): void {
    const promessa = listarSemLancar(listar);
    setPrimeiraPagina((atual) => ({ promessa, versao: (atual?.versao ?? 0) + 1 }));
  }

  return {
    abrir: () => {
      recarregar();
      setAberto(true);
    },
    props: { aberto, onAbertoChange: setAberto, primeiraPagina, onRecarregar: recarregar, listar },
  };
}

/**
 * Seletor de galeria do form de produto e da logo (specs/galeria-imagens-loja.md,
 * páginas 3 e 4). `Dialog` de tela cheia no mobile e janela centralizada a
 * partir de `md:` (mesma classe do `ProdutoModal`, com `md:max-w-3xl`).
 *
 * Dialog ANINHADO: no produto, ele abre de dentro do `Dialog`/`Sheet` do form.
 * O primitivo (Base UI) desliga o `Escape` e o clique-fora do dialog de baixo
 * enquanto este estiver aberto; além disso, o `Escape` aqui dentro é tratado e
 * PARADO neste popup (`design-system.md` §6), e o "Fechar" só muda o estado
 * deste seletor. O form por baixo nunca fecha junto.
 */
export function SeletorGaleria({
  aberto,
  onAbertoChange,
  primeiraPagina,
  onRecarregar,
  listar,
  onEscolher,
  onArquivoEscolhido,
}: SeletorGaleriaProps): ReactElement {
  function fecharComEscape(e: KeyboardEvent<HTMLDivElement>): void {
    if (e.key !== "Escape") return;
    e.stopPropagation();
    onAbertoChange(false);
  }

  return (
    <Dialog open={aberto} onOpenChange={(abrir) => onAbertoChange(abrir)}>
      <DialogContent
        showCloseButton={false}
        onKeyDown={fecharComEscape}
        className={cn(CLASSE_DIALOG_TELA_CHEIA, "md:max-w-3xl")}
      >
        {/* Montado só aberto: cada abertura começa da 1ª página. */}
        {aberto ? (
          <CorpoSeletor
            primeiraPagina={primeiraPagina}
            onRecarregar={onRecarregar}
            listar={listar}
            onFechar={() => onAbertoChange(false)}
            onEscolher={(imagem) => {
              onAbertoChange(false);
              onEscolher(imagem);
            }}
            onArquivoEscolhido={(arquivo) => {
              onAbertoChange(false);
              onArquivoEscolhido(arquivo);
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function Carregando(): ReactElement {
  return (
    <div
      className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground"
      aria-live="polite"
    >
      <Loader2 aria-hidden className="size-5 animate-spin" />
      <span>Carregando imagens...</span>
    </div>
  );
}

function CorpoSeletor({
  primeiraPagina,
  onRecarregar,
  listar,
  onFechar,
  onEscolher,
  onArquivoEscolhido,
}: {
  primeiraPagina: LeituraPrimeiraPagina | null;
  onRecarregar: () => void;
  listar: ListarGaleria;
  onFechar: () => void;
  onEscolher: (imagem: ImagemGaleria) => void;
  onArquivoEscolhido: (arquivo: File) => void;
}): ReactElement {
  const entradaRef = useRef<HTMLInputElement>(null);

  function aoSelecionarArquivo(e: ChangeEvent<HTMLInputElement>): void {
    const arquivo = e.target.files?.[0];
    e.target.value = "";
    if (arquivo) onArquivoEscolhido(arquivo);
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-2">
        <div className="min-w-0">
          <DialogTitle className="text-base font-semibold">Escolher da galeria</DialogTitle>
          <DialogDescription className="text-xs">
            Toque numa imagem para enquadrar.
          </DialogDescription>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={ALVO}
          onClick={onFechar}
          aria-label="Fechar galeria"
        >
          <X aria-hidden className="size-5" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {primeiraPagina ? (
          <Suspense fallback={<Carregando />}>
            {/* `key`: cada nova 1ª página (reabrir, "Tentar de novo") zera a lista. */}
            <ListaSeletor
              key={primeiraPagina.versao}
              primeiraPagina={primeiraPagina.promessa}
              onRecarregar={onRecarregar}
              listar={listar}
              onEscolher={onEscolher}
            />
          </Suspense>
        ) : (
          <Carregando />
        )}
      </div>

      <div className="shrink-0 border-t border-border p-4">
        <Button
          type="button"
          variant="outline"
          className={cn(ALVO, "w-full md:w-auto")}
          onClick={() => entradaRef.current?.click()}
        >
          <ImagePlus aria-hidden className="size-4" />
          Enviar nova imagem
        </Button>
        {/* Input próprio do seletor: o do form fica sob este dialog modal. */}
        <input
          ref={entradaRef}
          type="file"
          accept={TIPOS_IMAGEM_PERMITIDOS.join(",")}
          className="sr-only"
          onChange={aoSelecionarArquivo}
          aria-label="Selecionar imagem nova"
          tabIndex={-1}
        />
      </div>
    </div>
  );
}

function ListaSeletor({
  primeiraPagina,
  onRecarregar,
  listar,
  onEscolher,
}: {
  primeiraPagina: Promise<ResultadoListagemGaleria>;
  onRecarregar: () => void;
  listar: ListarGaleria;
  onEscolher: (imagem: ImagemGaleria) => void;
}): ReactElement {
  const r = use(primeiraPagina);
  const [lista, setLista] = useState<{ imagens: ImagemGaleria[]; cursor: CursorGaleria | null }>(
    () => (r.ok ? { imagens: r.imagens, cursor: r.proximo_cursor } : { imagens: [], cursor: null }),
  );

  if (!r.ok) {
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-center text-sm">
        <p role="alert">{MSG_LISTAGEM_FALHOU}</p>
        <Button type="button" variant="outline" className={ALVO} onClick={onRecarregar}>
          Tentar de novo
        </Button>
      </div>
    );
  }

  if (lista.imagens.length === 0) {
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">
        Sua galeria está vazia. Envie uma imagem nova para começar.
      </p>
    );
  }

  return (
    <GradeImagens
      imagens={lista.imagens}
      emUso={SEM_USO}
      selecao={{ modo: "unica", onEscolher }}
      proximoCursor={lista.cursor}
      listarMais={(cursor) => listar(cursor)}
      onPaginaCarregada={(pagina) =>
        setLista((atual) => ({
          imagens: anexarPagina(atual.imagens, pagina.imagens),
          cursor: pagina.proximo_cursor,
        }))
      }
      classeGrade="lg:grid-cols-4"
    />
  );
}

"use client";

import Image from "next/image";
import { X } from "lucide-react";
import { useEffect, useState, type RefObject } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  decidirModalSazonal,
  lerUltimaVisualizacaoSazonal,
  marcarVisualizadoSazonal,
} from "@/components/vitrine/decisaoModalSazonal";
import { PrecoProduto } from "@/components/vitrine/PrecoProduto";
import type { ProdutoModalDados } from "@/components/vitrine/ProdutoModal";
import { SeloDesconto } from "@/components/vitrine/SeloDesconto";
import { abrirProdutoEmFoco } from "@/hooks/useProdutoEmFoco";
import { fotoSegura } from "@/lib/utils/fotoSegura";
import { rotuloPrecoAcessivel } from "@/lib/utils/rotuloPrecoAcessivel";

/** Máximo de pratos listados; o resto vira a linha "e mais N" (design §5.4). */
const MAX_LISTADOS = 3;

/** [289] O prato tocado, à espera do fim da animação de fechamento (RN-5). */
type PratoPendente = ProdutoModalDados | null;

type ModalSazonalProps = {
  /**
   * Título CURADO pelo lojista (`modais_sazonais.titulo`), validado por zod na
   * escrita. Renderizado como TEXTO do React, NUNCA `dangerouslySetInnerHTML`
   * (RN-01): input externo é dado, nunca instrução.
   */
  titulo: string;
  /**
   * Produtos curados, derivados do catálogo no SSR (RN-10) e já enriquecidos
   * para o DETALHE por `derivarProdutosDoModalSazonal`. `ProdutoModalDados` é
   * SUPERSET de `ProdutoVitrine`: preço/selo/comprabilidade vêm prontos do
   * servidor. Vazia ⇒ o componente é `null`.
   */
  produtos: ProdutoModalDados[];
  /** Slug da loja — a chave do "já mostrei hoje" é POR loja (RN-07). */
  lojaSlug: string;
  /** "YYYY-MM-DD" no fuso da LOJA, derivado no servidor (RN-07). */
  diaDeHojeNaLoja: string;
  /** Injetado (RN-07) — nunca lido de `window` aqui dentro. */
  storage: Storage | null;
  /** OBRIGATÓRIO: para onde o foco volta e para onde o CTA leva o cliente. */
  destinoFoco: RefObject<HTMLElement | null>;
};

/**
 * Modal de divulgação sazonal na abertura da vitrine (spec modal-divulgacao-sazonal.md).
 *
 * Irmão do `ModalPromocoes`: molde EXATO das 7 travas anti-gesto, porque também
 * é um modal autorizado a abrir sem ninguém ter clicado em nada.
 *
 * 1. decisão ÚNICA, na montagem: a única transição para "aberto" está no
 *    `useEffect` de deps `[]`. Rolar, buscar, adicionar ao carrinho, voltar
 *    para a aba ou redimensionar não reabrem nada;
 * 2. ZERO temporizador;
 * 3. `scrollY > 0` ⇒ não abre (a aritmética mora em `decidirModalSazonal`);
 * 4. marca como visto NO INSTANTE DA DECISÃO, não no fechamento;
 * 5. um único `fechar()`, usado pelo `onOpenChange` do `Dialog` (ESC,
 *    clique-fora e o ✕), pelos dois CTAs e pelo toque num prato;
 * 6. nada no SSR: `aberto` começa `false` e só a hidratação pode mudá-lo;
 * 7. uma condição, um lugar: quem devolve `null` é este componente.
 *
 * E a trava que o navegador dá de graça: NENHUM handler escuta `touchstart`,
 * `pointerdown` ou `mousedown` — só `onClick`.
 *
 * A DIFERENÇA para o `ModalPromocoes`: aqui não há `toggleDaLoja` nem
 * `temPromocaoAtiva`. A existência de produtos curados (a lista não-vazia,
 * decidida no SSR a partir do modal ativo e dentro da janela) é a própria
 * condição de abertura. A precedência com o `ModalPromocoes` é resolvida no
 * servidor (RN-09) e desce como o `toggleDaLoja` dele — este componente não a
 * conhece.
 *
 * Nada de monetário é decidido aqui: preço, selo e vigência chegam prontos do
 * servidor no `ProdutoVitrine` (contrato de catálogo). Abrir o detalhe entrega
 * o produto ao store de foco; quem monta o payload de `adicionar` continua
 * sendo o ÚNICO `confirmarAdicao`, em `SecaoCatalogo`.
 */
export function ModalSazonal({
  titulo,
  produtos,
  lojaSlug,
  diaDeHojeNaLoja,
  storage,
  destinoFoco,
}: ModalSazonalProps) {
  const [aberto, setAberto] = useState(false);
  /**
   * [289/RN-5] O prato tocado, guardado até o modal sazonal TERMINAR de fechar.
   * Nunca dois dialogs abertos ao mesmo tempo: uma trava de scroll e um
   * focus-trap por vez.
   */
  const [pendente, setPendente] = useState<PratoPendente>(null);

  /* eslint-disable react-hooks/set-state-in-effect -- trava 1: a decisão é
     tomada UMA vez, na montagem, e é justamente essa abertura SÍNCRONA que
     impede o modal de aparecer no meio de um gesto já em curso. */
  useEffect(() => {
    const abrir = decidirModalSazonal({
      temModalSazonal: produtos.length > 0,
      diaDeHojeNaLoja,
      ultimaVisualizacao: lerUltimaVisualizacaoSazonal(storage, lojaSlug),
      // Único lugar que toca `window` — o módulo puro recebe o número pronto.
      scrollY: window.scrollY,
    });
    if (!abrir) return;
    // Trava 4: marca ANTES de mostrar. Recarregar a página com o modal aberto
    // não traz ele de volta hoje.
    marcarVisualizadoSazonal(storage, lojaSlug, diaDeHojeNaLoja);
    setAberto(true);
    // Deps `[]` de propósito (trava 1): nenhuma mudança de prop reabre.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Trava 7: a guarda de "não há o que mostrar" mora AQUI, e só aqui.
  if (produtos.length === 0) return null;

  const listados = produtos.slice(0, MAX_LISTADOS);
  const restantes = produtos.length - listados.length;

  /** Trava 5: o ÚNICO caminho de fechamento. */
  const fechar = () => setAberto(false);

  /**
   * [289/RN-1] Tocar num prato: registra o pendente e fecha pelo MESMO
   * `fechar()` de sempre. A abertura do detalhe é sequenciada abaixo.
   */
  const escolher = (produto: ProdutoModalDados) => {
    setPendente(produto);
    fechar();
  };

  return (
    <Dialog
      open={aberto}
      onOpenChange={(open) => (open ? null : fechar())}
      // [289/RN-5] "após terminarem as animações": só então o outro dialog
      // entra. O `ProdutoModal` é o de `SecaoCatalogo` — a instância ÚNICA da
      // vitrine —, alcançado pelo store de foco.
      onOpenChangeComplete={(open) => {
        if (open || !pendente) return;
        abrirProdutoEmFoco(pendente, "modal-sazonal");
        setPendente(null);
      }}
    >
      <DialogContent
        // Trava do foco (design §5.3): o modal abre sem trigger, então sem isto
        // o foco cairia no `<body>`. O destino é o MESMO alvo do CTA.
        // [289/RN-6] Com prato pendente quem move o foco é o `ProdutoModal` que
        // está prestes a abrir: `false` = "do nothing".
        finalFocus={pendente ? false : destinoFoco}
        className="max-w-[420px]"
        // O ✕ gerado pelo shadcn usa `size="icon-sm"` (abaixo do mínimo de
        // toque, design-system §5). Como `components/ui/` não se edita à mão, o
        // modal desliga aquele e traz o seu, de 44×44, ligado ao MESMO
        // `fechar()` (trava 5).
        showCloseButton={false}
      >
        <button
          type="button"
          onClick={fechar}
          aria-label="Fechar"
          className="absolute top-2 right-2 inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-texto-muted focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[var(--cor-primaria)]"
        >
          <X aria-hidden className="size-5" />
        </button>

        <DialogHeader className="pr-14">
          {/* RN-01: título do lojista renderizado como TEXTO do React (escape
              automático), NUNCA innerHTML. */}
          <DialogTitle className="text-base font-extrabold tracking-wide uppercase">
            <span>{titulo}</span>
          </DialogTitle>
          <DialogDescription>
            {produtos.length === 1
              ? "1 prato em destaque"
              : `${produtos.length} pratos em destaque`}
          </DialogDescription>
        </DialogHeader>

        {/* Cada prato listado ABRE O DETALHE dele (mesmo padrão do
            `ModalPromocoes`): só `onClick`, nunca `pointerdown`/`touchstart`/
            `mousedown`, e as sete travas permanecem. */}
        <ul className="flex flex-col gap-3 px-4">
          {listados.map((produto) => {
            const foto = fotoSegura(produto.foto_url);
            return (
              <li key={produto.id}>
                <button
                  type="button"
                  onClick={() => escolher(produto)}
                  aria-label={`Ver detalhes de ${produto.nome}, ${rotuloPrecoAcessivel(produto)}`}
                  // Alvo de toque em valor LITERAL (design-system §5): a base de
                  // fonte do projeto é 120%, então `min-h-11` não vale 44px.
                  className="flex min-h-[44px] w-full items-center gap-3 rounded-lg text-left focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[var(--cor-primaria)]"
                >
                  <span className="block size-14 shrink-0 overflow-hidden rounded-lg">
                    {foto ? (
                      <Image
                        src={foto}
                        alt=""
                        width={112}
                        height={112}
                        unoptimized
                        className="size-full object-cover"
                      />
                    ) : (
                      <span
                        aria-hidden
                        className="block size-full bg-[linear-gradient(135deg,#e8dcc4,#d8c4a0)]"
                      />
                    )}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate font-semibold text-texto">
                      {produto.nome}
                    </span>
                    <PrecoProduto produto={produto} tamanho="lista" />
                  </span>
                  <SeloDesconto rotulo={produto.seloDesconto} ancoragem="inline" />
                </button>
              </li>
            );
          })}
          {restantes > 0 ? (
            <li className="text-sm text-texto-muted">
              {restantes === 1
                ? "e mais 1 prato"
                : `e mais ${restantes} pratos`}
            </li>
          ) : null}
        </ul>

        <DialogFooter>
          {/* Duas saídas rotuladas, nunca só o ✕. Alvo de toque em valor
              LITERAL (design-system §5). */}
          <button
            type="button"
            onClick={fechar}
            className="inline-flex min-h-[52px] w-full items-center justify-center rounded-xl bg-[var(--cor-primaria)] px-4 text-sm font-bold tracking-wide text-white uppercase focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[var(--cor-primaria)]"
          >
            Ver cardápio
          </button>
          <button
            type="button"
            onClick={fechar}
            className="inline-flex min-h-[44px] w-full items-center justify-center rounded-xl border border-borda-nav px-4 text-sm font-semibold text-texto focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[var(--cor-primaria)]"
          >
            Continuar vendo o cardápio
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

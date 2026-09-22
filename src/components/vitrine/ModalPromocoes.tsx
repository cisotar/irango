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
  decidirModalPromocoes,
  lerUltimaVisualizacao,
  marcarVisualizado,
} from "@/components/vitrine/decisaoModalPromocoes";
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

type ModalPromocoesProps = {
  /**
   * Lista derivada do catálogo no SSR (RN-15), já enriquecida para o DETALHE
   * por `derivarPromocionaisParaModal` — opcionais e frase de vigência vêm
   * prontos do servidor (289/RN-9). `ProdutoModalDados` é SUPERSET de
   * `ProdutoVitrine`: a marcação de foto/nome/preço/selo não muda.
   * Vazia ⇒ o componente é `null`.
   */
  promocoes: ProdutoModalDados[];
  /** Slug da loja — a chave do "já mostrei hoje" é POR loja (RN-18). */
  lojaSlug: string;
  /** `lojas.modal_promocoes`, do SSR via `vitrine_lojas`. */
  toggleDaLoja: boolean;
  /** "YYYY-MM-DD" no fuso da LOJA, derivado no servidor (RN-16). */
  diaDeHojeNaLoja: string;
  /** Injetado (RN-18) — nunca lido de `window` aqui dentro. */
  storage: Storage | null;
  /** OBRIGATÓRIO: para onde o foco volta e para onde o CTA leva o cliente. */
  destinoFoco: RefObject<HTMLElement | null>;
};

/**
 * Modal de promoções na abertura da vitrine (D6, RN-16/17/18, design §5).
 *
 * É o único modal do projeto autorizado a abrir sem ninguém ter clicado em
 * nada — e por isso carrega travas que o carrinho (PR #139) não precisou:
 *
 * 1. decisão ÚNICA, na montagem: a única transição para "aberto" do arquivo
 *    está no `useEffect` de deps `[]`. Rolar, buscar, adicionar ao carrinho,
 *    voltar para a aba ou redimensionar não reabrem nada;
 * 2. ZERO temporizador: modal que aparece depois de N segundos é exatamente o
 *    padrão que intercepta o toque no meio do gesto;
 * 3. `scrollY > 0` ⇒ não abre (a aritmética mora em `decidirModalPromocoes`);
 * 4. marca como visto NO INSTANTE DA DECISÃO, não no fechamento: fechar por
 *    ESC, ✕, clique-fora, CTA ou recarregar têm todos o mesmo efeito;
 * 5. um único `fechar()`, usado pelo `onOpenChange` do `Dialog` (que cobre ESC,
 *    clique-fora e o ✕), pelos dois CTAs e pelo toque num prato — não há
 *    segundo caminho para alguém esquecer de instrumentar;
 * 6. nada no SSR: `aberto` começa `false` e só a hidratação pode mudá-lo. JS
 *    falhando ⇒ a vitrine inteira funciona e o modal simplesmente não existe;
 * 7. uma condição, um lugar: quem devolve `null` é este componente, não o pai.
 *
 * E a trava que o navegador dá de graça: NENHUM handler aqui escuta
 * `touchstart`, `pointerdown` ou `mousedown` — só `onClick`. É o que preserva a
 * regra nativa "click exige down E up no mesmo elemento", então um gesto que
 * começou na página e terminou sobre o modal não ativa CTA nenhum.
 *
 * Nada de monetário é decidido aqui: preço, selo e vigência chegam prontos do
 * servidor no `ProdutoVitrine` (contrato de catálogo, regra 6). Abrir o detalhe
 * também não decide nada: o produto é entregue ao store de foco e quem monta o
 * payload de `adicionar` (com `temDesconto`, origem de `promocaoExibida`,
 * 238/RN-12-a) continua sendo o ÚNICO `confirmarAdicao`, em `SecaoCatalogo`.
 */
export function ModalPromocoes({
  promocoes,
  lojaSlug,
  toggleDaLoja,
  diaDeHojeNaLoja,
  storage,
  destinoFoco,
}: ModalPromocoesProps) {
  const [aberto, setAberto] = useState(false);
  /**
   * [289/RN-5] O prato tocado, guardado até o modal promocional TERMINAR de
   * fechar. Nunca dois dialogs abertos ao mesmo tempo: uma trava de scroll e um
   * focus-trap por vez.
   */
  const [pendente, setPendente] = useState<PratoPendente>(null);

  /* eslint-disable react-hooks/set-state-in-effect -- trava 1: a decisão é
     tomada UMA vez, na montagem, e é justamente essa abertura SÍNCRONA que
     impede o modal de aparecer no meio de um gesto já em curso. */
  useEffect(() => {
    const abrir = decidirModalPromocoes({
      toggleDaLoja,
      temPromocaoAtiva: promocoes.length > 0,
      diaDeHojeNaLoja,
      ultimaVisualizacao: lerUltimaVisualizacao(storage, lojaSlug),
      // Único lugar que toca `window` — o módulo puro recebe o número pronto.
      scrollY: window.scrollY,
    });
    if (!abrir) return;
    // Trava 4: marca ANTES de mostrar. Recarregar a página com o modal aberto
    // não traz ele de volta hoje.
    marcarVisualizado(storage, lojaSlug, diaDeHojeNaLoja);
    setAberto(true);
    // Deps `[]` de propósito (trava 1): nenhuma mudança de prop reabre.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Trava 7: a guarda de "não há o que mostrar" mora AQUI, e só aqui.
  if (promocoes.length === 0 || !toggleDaLoja) return null;

  const listados = promocoes.slice(0, MAX_LISTADOS);
  const restantes = promocoes.length - listados.length;

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
      // [289/RN-5] "após terminarem as animações" (`DialogRoot.d.ts`): só então
      // o outro dialog entra. O `ProdutoModal` é o de `SecaoCatalogo` — a
      // instância ÚNICA da vitrine —, alcançado pelo store de foco (D1).
      onOpenChangeComplete={(open) => {
        if (open || !pendente) return;
        abrirProdutoEmFoco(pendente, "promocoes");
        setPendente(null);
      }}
    >
      <DialogContent
        // Trava do foco (design §5.3): o modal abre sem trigger, então sem isto
        // o foco cairia no `<body>` e o cliente de teclado/leitor de tela seria
        // jogado para o topo do documento. O destino é o MESMO alvo do CTA
        // "Ver promoções" — foco e scroll nunca divergem.
        // [289/RN-6] Com prato pendente quem move o foco é o `ProdutoModal` que
        // está prestes a abrir: `false` = "do nothing" (`DialogPopup.d.ts`), e
        // sem isso o foco iria ao `<main>` só para saltar logo em seguida.
        finalFocus={pendente ? false : destinoFoco}
        className="max-w-[420px]"
        // O ✕ gerado pelo shadcn usa `size="icon-sm"` (33,6px com a base de
        // fonte de 120% — abaixo do mínimo de toque, design-system §5). Como
        // `components/ui/` não se edita à mão, o modal desliga aquele e traz o
        // seu, de 44×44, ligado ao MESMO `fechar()` (trava 5).
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
          <DialogTitle className="text-base font-extrabold tracking-wide uppercase">
            Promoções de hoje
          </DialogTitle>
          <DialogDescription>
            {promocoes.length === 1
              ? "1 prato com desconto agora"
              : `${promocoes.length} pratos com desconto agora`}
          </DialogDescription>
        </DialogHeader>

        {/* [289] Cada prato listado ABRE O DETALHE dele. A decisão anterior —
            linhas não interativas, "o único CTA é o do rodapé"
            (`specs/arquivo/desconto-por-produto-e-pratos-promocionais.md` §5.4)
            — foi SUPERSEDIDA por
            `specs/abrir-produto-a-partir-do-modal-de-promocoes.md`, seção
            "Supersessão declarada": aquele CTA levava ao topo do `<main>` e
            fazia da promoção um beco sem saída. O argumento original segue
            válido quanto a TOQUE ACIDENTAL, e é por isso que aqui só existe
            `onClick` (nunca `pointerdown`/`touchstart`/`mousedown`) e as sete
            travas permanecem. */}
        <ul className="flex flex-col gap-3 px-4">
          {listados.map((produto) => {
            const foto = fotoSegura(produto.foto_url);
            return (
              <li key={produto.id}>
                <button
                  type="button"
                  onClick={() => escolher(produto)}
                  // Sem `rotuloPrecoAcessivel` o cliente cego ouviria só o preço
                  // cheio, nunca o promocional (233).
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
                ? "e mais 1 prato em promoção"
                : `e mais ${restantes} pratos em promoção`}
            </li>
          ) : null}
        </ul>

        <DialogFooter>
          {/* Duas saídas rotuladas, nunca só o ✕. Alvo de toque em valor
              LITERAL (design-system §5): a base de fonte do projeto é 120%,
              então `min-h-11` não vale 44px. */}
          <button
            type="button"
            onClick={fechar}
            className="inline-flex min-h-[52px] w-full items-center justify-center rounded-xl bg-[var(--cor-primaria)] px-4 text-sm font-bold tracking-wide text-white uppercase focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[var(--cor-primaria)]"
          >
            Ver promoções
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

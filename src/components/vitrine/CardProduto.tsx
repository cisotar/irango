"use client";

import Image from "next/image";

import {
  rotuloAcessivelNaoCompravel,
  rotuloNaoCompravel,
} from "@/components/vitrine/rotuloEsgotado";
import { PrecoProduto } from "@/components/vitrine/PrecoProduto";
import { SeloDesconto } from "@/components/vitrine/SeloDesconto";
import { TextoRealcado } from "@/components/vitrine/TextoRealcado";
import type { ProdutoVitrine } from "@/lib/utils/catalogoVitrine";
import { fotoSegura } from "@/lib/utils/fotoSegura";
import { rotuloPrecoAcessivel } from "@/lib/utils/rotuloPrecoAcessivel";

type CardProdutoProps = {
  /**
   * Contrato de catálogo (224/225): UM objeto obrigatório, produzido no
   * servidor. Sem campo avulso com default — campo faltando é erro de
   * compilação, não "disponível" silencioso (D13).
   *
   * A `descricao` segue no contrato, mas o design-claude não a exibe no card —
   * por isso o realce da busca (200) cobre só o `nome`.
   */
  produto: ProdutoVitrine;
  /** Termo de busca ativo (200). Ausente/vazio → nome renderiza como antes. */
  termo?: string;
  /**
   * [262] A frase de "quando volta", pronta do servidor
   * (`rotulosVigencia[produto.id]`). Só é lida quando
   * `motivoNaoCompravel === "fora_da_janela"`; ausente ⇒ o fallback visível
   * "Indisponível no momento" (design §4.1), nunca selo em branco.
   */
  rotuloIndisponivel?: string;
  /**
   * Abre o modal de detalhe do produto. Dispara MESMO com o produto não
   * comprável (262/design §4.2): "Só aos sábados e domingos, das 11:00 às
   * 15:00" não cabe na pílula em 360px, e o modal é o único lugar onde a frase
   * inteira cabe. Adicionar continua impossível — o modal não comprável não tem
   * CTA de adicionar, e a autoridade é a Server Action (RN-08).
   */
  onAdicionar: () => void;
};

/**
 * Card de produto da vitrine — espelha design-claude/vitrine/card-produto.html:
 * foto 4:3, nome em 2 linhas, preço na cor de DESTAQUE da loja e botão "+"
 * quadrado (44×44) também na cor de destaque com texto branco fixo (contraste
 * seguro, design-system §4). Não comprável → a MESMA pílula no rodapé da imagem
 * + overlay cinza + botão desabilitado; o TEXTO da pílula vem do motivo
 * ("Esgotado" ou a frase de "quando volta" do servidor, 262). Apresentação
 * pura — o pai decide `onAdicionar`, e o card sempre o chama.
 *
 * O preço exibido é o EFETIVO (o que o cliente paga agora), impresso por
 * `PrecoProduto` — o card NÃO formata preço por conta própria (M1). Em promoção
 * o par riscado/efetivo empilha e o selo entra no canto superior esquerdo da
 * foto (233, design §3.2): nunca colide com a pílula de indisponibilidade, que
 * mora no rodapé-centro — os dois podem coexistir.
 *
 * Nada de monetário é decidido aqui: `temDesconto` e `seloDesconto` chegam
 * prontos do servidor (regra 6 do contrato de catálogo).
 */
export function CardProduto({
  produto,
  termo,
  rotuloIndisponivel,
  onAdicionar,
}: CardProdutoProps) {
  const { nome, foto_url, compravel, motivoNaoCompravel, seloDesconto } = produto;
  const foto = fotoSegura(foto_url);
  // O texto sai do módulo único (`rotuloEsgotado.ts`): o card não sabe compor
  // frase de vigência e nunca avalia janela a partir de dado cru.
  const rotulo = rotuloNaoCompravel(motivoNaoCompravel, rotuloIndisponivel);

  return (
    <article
      // O card SEMPRE abre o modal, comprável ou não (262): um card marcado que
      // não abre é beco sem saída — a mesma classe de erro que o D13 fechou.
      onClick={onAdicionar}
      className={`relative flex cursor-pointer flex-col overflow-hidden rounded-xl border border-[#eeeeee] bg-white shadow-[0_4px_12px_rgba(0,0,0,0.1)] ${
        compravel ? "" : "[&_.card-body]:opacity-60"
      }`}
    >
      <div className="relative aspect-[4/3] w-full">
        {foto ? (
          <Image
            src={foto}
            alt={nome}
            width={400}
            height={300}
            unoptimized
            className="size-full object-cover"
          />
        ) : (
          <div
            aria-hidden
            className="size-full bg-[linear-gradient(135deg,#e8dcc4,#d8c4a0)]"
          />
        )}
        {!compravel ? (
          <>
            <span
              aria-hidden
              className="absolute inset-0 bg-black/35 [backdrop-filter:grayscale(1)]"
            />
            {/* MESMA pílula de 225 — só o texto muda (D4). `max-w`/`truncate`
                entram porque a frase de vigência é longa: sem eles ela
                estouraria os 168px do card e cobriria o prato. O corte é
                visual; a frase inteira está no `aria-label` do "+" e no modal,
                que este card abre. */}
            <span className="absolute bottom-[10px] left-1/2 z-[2] max-w-[calc(100%-16px)] -translate-x-1/2 truncate whitespace-nowrap rounded-full bg-[#111111] px-[18px] py-2 text-sm font-extrabold uppercase tracking-wide text-white shadow-[0_2px_10px_rgba(0,0,0,0.35)]">
              {rotulo}
            </span>
          </>
        ) : null}
        {/* Canto SUPERIOR ESQUERDO: o wrapper dá a posição, o selo dá a forma
            (o componente não expõe `className` — posição é do consumidor). O
            wrapper só existe COM promoção: sem desconto a árvore do card é
            exatamente a de hoje, nem um nó a mais. */}
        {seloDesconto ? (
          <div className="absolute left-2 top-2 z-[2]">
            <SeloDesconto rotulo={seloDesconto} ancoragem="foto" />
          </div>
        ) : null}
      </div>

      <div className="card-body flex flex-1 flex-col gap-2 p-3 lg:gap-1.5 lg:p-2.5">
        {/* `alt` da imagem e `aria-label` do botão continuam a string CRUA:
            atributo não aceita nó React, e é o nome inteiro que o leitor de
            tela deve ouvir. O realce é estritamente visual. */}
        <h3 className="line-clamp-2 text-sm font-bold leading-tight text-[#111111] lg:text-xs">
          <TextoRealcado texto={nome} termo={termo} />
        </h3>

        {/* `items-end`: com desconto o bloco de preço ganha DUAS linhas e o "+"
            fica alinhado ao final da coluna. Sem desconto a árvore é a de
            hoje — a altura do card não muda. */}
        <div className="mt-auto flex items-end justify-between gap-2">
          <PrecoProduto produto={produto} tamanho="card" />
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onAdicionar(); }}
            disabled={!compravel}
            aria-label={
              compravel
                ? `Adicionar ${nome} ao carrinho, ${rotuloPrecoAcessivel(produto)}`
                : rotuloAcessivelNaoCompravel(nome, motivoNaoCompravel, rotuloIndisponivel)
            }
            // `pointer-events-none` é a peça que resolve o conflito do design
            // §4.2: navegador nenhum propaga `click` de elemento `disabled`,
            // então sem ela o dedo que cai sobre o "+" morre ali e a tela
            // parece travada. Com ela o toque ATRAVESSA até o card, que abre o
            // modal. O botão continua no DOM e continua `disabled`.
            className={`${compravel ? "" : "pointer-events-none "}flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--cor-destaque)] text-base font-black leading-none text-white focus-visible:outline-3 focus-visible:-outline-offset-3 focus-visible:outline-white disabled:cursor-not-allowed disabled:bg-[#9a9a9a] lg:h-7 lg:w-7 lg:text-sm`}
          >
            +
          </button>
        </div>
      </div>
    </article>
  );
}

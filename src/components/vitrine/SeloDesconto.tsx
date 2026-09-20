import { Badge } from "@/components/ui/badge";

type SeloDescontoProps = {
  /**
   * Texto PRONTO, vindo do servidor (`ProdutoVitrine.seloDesconto`: "-20%" ou
   * "-R$ 10,00"). `null` ⇒ o componente devolve `null`.
   */
  rotulo: string | null;
  /** "foto" (sobreposto à imagem) | "inline" (no fluxo de texto). Sem default. */
  ancoragem: "foto" | "inline";
};

/**
 * Chip de PROMOÇÃO da vitrine. Apresentação pura: nada de monetário é calculado
 * aqui — o rótulo chega decidido do servidor (regra 6 do contrato de catálogo).
 *
 * Cor de SISTEMA, nunca cor do tema da loja (design-system §8): promoção precisa
 * significar a mesma coisa em qualquer loja, e o tema é escolhido pelo lojista
 * (podendo falhar contraste, §4). O selo pinta fundo opaco próprio + borda de
 * 1,5px, então o par de contraste medido é sempre (texto do selo × fundo do
 * selo) — `--promo-texto` sobre `--promo-fundo` ≈ 7:1, AA e AAA para texto
 * normal — nunca × a foto do produto nem × a cor do lojista. E sempre
 * **cor + texto**, nunca cor sozinha (WCAG, §5).
 *
 * O `return null` mora AQUI (M3): sem isso, cada uma das quatro superfícies
 * precisaria lembrar de um `{x && ...}` próprio — uma decisão, um lugar.
 *
 * NÃO é interativo: sem botão, sem `title`, sem tooltip. Um chip que só existe
 * no hover não existe no celular.
 */
export function SeloDesconto({ rotulo, ancoragem }: SeloDescontoProps) {
  if (rotulo === null) return null;

  return (
    <Badge
      className={`${ancoragem === "foto" ? "absolute z-[2] " : ""}h-auto whitespace-nowrap rounded-full border-[1.5px] border-promo-borda bg-promo-fundo px-2.5 py-1 text-xs font-extrabold tracking-wide text-promo-texto uppercase shadow-[0_2px_10px_rgba(0,0,0,0.25)]`}
    >
      {rotulo}
    </Badge>
  );
}

"use client";

import { useState, type ReactElement } from "react";
import Link from "next/link";
import { MoreVertical } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuPortal,
  MenuPositioner,
  MenuTrigger,
} from "@/components/ui/menu";
import { PilulasDeDias } from "@/components/painel/PilulasDeDias";
import { payloadDeDias } from "@/components/painel/agendaDoVinculo";
import type {
  AcoesLote,
  CardapioParaLote,
} from "@/components/painel/contrato-lote";

/** A régua de `design-system.md` §5: valor LITERAL, nunca `min-h-11`. */
const ALVO = "min-h-[44px] min-w-[44px]";

/**
 * Um item JÁ VINCULADO a este cardápio. Tudo que é frase ou veredito chega
 * REDIGIDO do servidor, com o fuso da loja — o browser não avalia dia nem
 * formata dinheiro de vitrine.
 */
export type ItemDoCardapio = {
  id: string;
  nome: string;
  /** [261] D14 — `visibilidade = 'cardapio'`, já estreitado no servidor. */
  exclusivo: boolean;
  /** Os dias do VÍNCULO. `null` = todos os dias do cardápio (RN-11). */
  dias: number[] | null;
  /** A linha de agenda, JÁ REDIGIDA no servidor (`fraseAgendaDoItem`). */
  fraseAgenda: string;
  /** RN-06, redigido no SERVIDOR. `null` = a agenda abre em algum dia. */
  avisoNuncaAbre: string | null;
  /** `formatarMoeda` aplicada no SERVIDOR. */
  precoRotulo: string;
  /** `null` = produto sem categoria. */
  categoriaNome: string | null;
};

export type ItensDoCardapioProps = {
  cardapio: CardapioParaLote;
  itens: ItemDoCardapio[];
  acoes: AcoesLote;
  /**
   * Destino do "Editar produto", INJETADO: componente compartilhado não conhece
   * rota (é o que a trava de `rotaCardapiosInjetada.test.tsx` vigia). `null` =
   * o mundo que monta esta tela não oferece a edição do produto.
   */
  hrefEditarProduto: ((produtoId: string) => string) | null;
  /** Abre o sheet de adicionar — o CTA do estado vazio. */
  onAdicionar: () => void;
  /**
   * [D8] Pede a remoção do item. Quem confirma é o ciclo de lote
   * (`useLoteDeProdutos`), com a PRÉVIA DO SERVIDOR e a copy do módulo puro de
   * lote — este componente não conta nem redige nada, e por isso não existe um
   * segundo caminho de escrita nem uma segunda redação.
   */
  onTirar: (produtoId: string) => void;
  /** Recarrega o SSR (`router.refresh`): a verdade continua sendo do servidor. */
  onMudou: () => void;
};

/**
 * [288/D2] Os itens DESTE cardápio, um `Card` por item — o corpo da página.
 *
 * Antes eles eram minoria visual dentro do checklist da loja inteira; agora o
 * checklist virou o sheet e a página mostra só o objeto da tela. A agenda fica
 * INLINE no card (D5): ajustar dia é a edição mais frequente depois de
 * adicionar, e `PilulasDeDias` já é acessível e com autosave.
 *
 * Nenhuma frase é redigida aqui: agenda e aviso vêm do servidor, a confirmação
 * da remoção é o diálogo de lote (prévia do SERVIDOR, RN-09-a) disparado por
 * `onTirar`, e a recusa da escrita é a frase da própria Server Action. Nem a
 * copy de lote nem `AlertDialog` são importados aqui — é o que o teste ao lado
 * afirma, para que a contagem nunca volte a nascer no cliente.
 */
export function ItensDoCardapio({
  cardapio,
  itens,
  acoes,
  hrefEditarProduto,
  onAdicionar,
  onTirar,
  onMudou,
}: ItensDoCardapioProps): ReactElement {
  /**
   * [276] Estado OTIMISTA por `produto_id` — a mesma mecânica que vivia no
   * `SeletorProdutosDoCardapio`, sem mudança de lógica: a pílula pinta antes de
   * a escrita voltar e desfaz se a action recusar. A fonte da verdade continua
   * sendo o SSR.
   */
  const [agendas, setAgendas] = useState<Record<string, number[] | null>>({});
  const [emVoo, setEmVoo] = useState<ReadonlySet<string>>(() => new Set());
  const [anuncios, setAnuncios] = useState<Record<string, string>>({});

  async function salvarDias(
    item: ItemDoCardapio,
    dias: number[],
  ): Promise<void> {
    const anterior = agendas[item.id] ?? item.dias;
    setAgendas((atual) => ({ ...atual, [item.id]: dias }));
    setAnuncios((atual) => ({ ...atual, [item.id]: "Salvando…" }));
    // Decisão D do desenho: o grupo desabilita enquanto a escrita está em voo.
    // Duas escritas concorrentes do array inteiro teriam como vencedor o último
    // a CHEGAR, não o último CLICADO.
    setEmVoo((atual) => new Set(atual).add(item.id));
    try {
      const resultado = await acoes.definirDias(
        payloadDeDias(cardapio.id, item.id, dias),
      );
      if (!resultado.ok) {
        setAgendas((atual) => ({ ...atual, [item.id]: anterior }));
        setAnuncios((atual) => ({ ...atual, [item.id]: "" }));
        // A frase é a da action (alheio e inexistente byte a byte iguais);
        // nenhum detalhe de banco é redigido aqui.
        toast.error(resultado.erro);
        return;
      }
      setAnuncios((atual) => ({ ...atual, [item.id]: "Dias salvos." }));
      onMudou();
    } finally {
      setEmVoo((atual) => {
        const proximo = new Set(atual);
        proximo.delete(item.id);
        return proximo;
      });
    }
  }

  if (itens.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2 text-center">
          <p className="font-heading text-base font-semibold">
            Nenhum item neste cardápio ainda
          </p>
          <p className="text-sm text-texto-muted">
            Um cardápio sem item não muda nada na vitrine.
          </p>
          <Button type="button" className={ALVO} onClick={onAdicionar}>
            Adicionar item
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <ul className="grid gap-2 md:grid-cols-2">
        {itens.map((item) => {
          const salvando = emVoo.has(item.id);
          const dias = agendas[item.id] ?? item.dias ?? [];
          const idAgenda = `agenda-${item.id}`;
          const href = hrefEditarProduto?.(item.id) ?? null;
          return (
            <li key={item.id}>
              <Card aria-busy={salvando}>
                <CardContent className="flex flex-col gap-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 flex-col gap-1">
                      <p className="text-[1.02rem] leading-snug font-semibold">
                        {item.nome}
                      </p>
                      <p className="text-sm text-texto-muted tabular-nums">
                        {item.categoriaNome === null
                          ? item.precoRotulo
                          : `${item.precoRotulo} · ${item.categoriaNome}`}
                      </p>
                    </div>

                    <Menu>
                      <MenuTrigger
                        render={
                          <Button
                            variant="ghost"
                            className={ALVO}
                            aria-label={`Mais ações de ${item.nome}`}
                          />
                        }
                      >
                        <MoreVertical aria-hidden className="size-4" />
                      </MenuTrigger>
                      <MenuPortal>
                        <MenuPositioner align="end">
                          <MenuPopup>
                            {href !== null ? (
                              <MenuItem
                                className="min-h-[44px]"
                                render={<Link href={href} />}
                              >
                                Editar produto
                              </MenuItem>
                            ) : null}
                            {/* D9: desmarcar as 7 pílulas grava `[]` → NULL,
                                mas o lojista não tem como saber disso. */}
                            <MenuItem
                              className="min-h-[44px]"
                              aria-disabled={salvando}
                              onClick={() => void salvarDias(item, [])}
                            >
                              Voltar a todos os dias do cardápio
                            </MenuItem>
                            <MenuItem
                              className="min-h-[44px] text-destructive"
                              onClick={() => onTirar(item.id)}
                            >
                              Tirar do cardápio
                            </MenuItem>
                          </MenuPopup>
                        </MenuPositioner>
                      </MenuPortal>
                    </Menu>
                  </div>

                  {/* [261] É esta diferença que decide o que acontece com o
                      produto quando o cardápio fechar. */}
                  {item.exclusivo ? (
                    <Badge variant="secondary" className="w-fit">
                      Exclusivo de cardápio
                    </Badge>
                  ) : null}

                  <p id={idAgenda} className="text-xs text-texto-muted">
                    {item.fraseAgenda}
                  </p>
                  <PilulasDeDias
                    compacto
                    valor={dias}
                    onChange={(proximos) => void salvarDias(item, proximos)}
                    rotulo={`Dias em que ${item.nome} aparece neste cardápio`}
                    descritoPor={idAgenda}
                    desabilitado={salvando}
                  />

                  {/* RN-06: avisa, não bloqueia. Sem `aria-invalid`, sem roubar
                      foco, sem oferecer conserto — o consertável é a vigência
                      do cardápio, na mesma rota. */}
                  {item.avisoNuncaAbre !== null ? (
                    <p
                      role="status"
                      className="rounded-lg border border-amber-300 bg-amber-100 px-2 py-1 text-xs text-amber-900"
                    >
                      {item.avisoNuncaAbre}
                    </p>
                  ) : null}
                  <p aria-live="polite" className="sr-only">
                    {anuncios[item.id] ?? ""}
                  </p>
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ul>
    </>
  );
}

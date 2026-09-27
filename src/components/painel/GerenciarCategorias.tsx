"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  Clock,
  EyeOff,
  Loader2,
  MoreVertical,
  Pencil,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { AvisoFrequencia, ChipFrequencia } from "@/components/painel/RotuloFrequencia";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuPortal,
  MenuPositioner,
  MenuTrigger,
} from "@/components/ui/menu";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import type { Categoria } from "@/components/painel/FormProduto";
import type { FrequenciasDoPainel } from "@/lib/utils/frequenciaPainel";
import type {
  criarCategoria as criarCategoriaLojista,
  atualizarCategoria as atualizarCategoriaLojista,
  removerCategoria as removerCategoriaLojista,
} from "@/lib/actions/produto";

/**
 * Gestão das categorias de PRODUTO (não confundir com categorias de OPCIONAL).
 * A categoria de produto agrupa o catálogo na vitrine E é o elo que resolve quais
 * opcionais um produto aceita (associação 089). Sem ela, produto cai em "Sem
 * categoria" e nunca herda opcionais. O backend (criar/atualizar/removerCategoria)
 * já existia; faltava só esta UI para criá-las pelo painel.
 *
 * `ordem` é auto-atribuída (fim da lista) — o schema do servidor exige int>=0.
 *
 * [323] Cada categoria ganha "Mostrar na vitrine" (`oculta`, RN-2) e o botão
 * "Frequência…" (abre o `DialogoFrequencia` do pai). O layout da linha foi
 * reorganizado (mockup §5) para caber no Sheet de 360px com alvos de 44px
 * literais — Renomear/Remover foram para o kebab, fechando a 291 aqui.
 */

/** A régua de `design-system.md` §5: valor LITERAL (base de fonte 120%). */
const ALVO = "min-h-[44px] min-w-[44px]";

export function GerenciarCategorias({
  categorias,
  open,
  onOpenChange,
  onCriar,
  onAtualizar,
  onRemover,
  onAlternarExibirImagens,
  onAlternarOculta,
  onAbrirFrequencia,
  frequencias,
}: {
  categorias: Categoria[];
  open: boolean;
  onOpenChange: (aberto: boolean) => void;
  /**
   * Actions injetadas. OBRIGATÓRIAS (issue 160): o `ProdutosClient` repassa as
   * do seu `acoes`, que a page do painel preenche com as do lojista e a via
   * admin com as variantes escopadas por `lojaId`. Sem default — omitir uma
   * quebra o build em vez de gravar na loja errada.
   */
  onCriar: typeof criarCategoriaLojista;
  onAtualizar: typeof atualizarCategoriaLojista;
  onRemover: typeof removerCategoriaLojista;
  onAlternarExibirImagens: (
    id: string,
    exibirImagens: boolean,
  ) => Promise<{ ok: boolean; erro?: string }>;
  /** [323] `alternarOcultaCategoria` (ou a admin com `lojaId` fixado). */
  onAlternarOculta: (
    id: string,
    oculta: boolean,
  ) => Promise<{ ok: boolean; erro?: string }>;
  /** [323] Abre o diálogo de frequência da categoria (o pai é o dono dele). */
  onAbrirFrequencia: (categoria: Categoria) => void;
  /** [323] Projeção do servidor: oculta, chip e aviso por categoria. */
  frequencias: FrequenciasDoPainel["categorias"];
}) {
  const router = useRouter();
  const [nova, setNova] = useState("");
  const [salvando, startSalvar] = useTransition();

  // Edição inline de uma categoria existente.
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [nomeEdicao, setNomeEdicao] = useState("");

  // Preview otimista do toggle "exibir imagens", por categoria (id → estado
  // local). Fonte de verdade é `categoria.exibir_imagens` (prop); este mapa só
  // existe enquanto uma alternância está em voo ou acabou de ser confirmada
  // nesta sessão — evita esperar o `router.refresh()` para o switch responder.
  const [exibicaoOtimista, setExibicaoOtimista] = useState<
    Record<string, boolean>
  >({});

  function alternarExibirImagens(cat: Categoria) {
    const anterior = exibicaoOtimista[cat.id] ?? cat.exibir_imagens;
    const novo = !anterior;
    setExibicaoOtimista((atual) => ({ ...atual, [cat.id]: novo })); // otimista
    startSalvar(async () => {
      const r = await onAlternarExibirImagens(cat.id, novo);
      if (!r.ok) {
        setExibicaoOtimista((atual) => ({ ...atual, [cat.id]: anterior })); // rollback
        toast.error(r.erro ?? "Não foi possível atualizar a categoria.");
        return;
      }
      router.refresh();
    });
  }

  // [323] Mesmo molde otimista do "exibir imagens", para "Mostrar na vitrine".
  // Fonte de verdade: `frequencias[id].oculta` (servidor).
  const [ocultaOtimista, setOcultaOtimista] = useState<Record<string, boolean>>({});

  function ocultaDe(cat: Categoria): boolean {
    return ocultaOtimista[cat.id] ?? frequencias[cat.id]?.oculta ?? false;
  }

  function definirOculta(cat: Categoria, oculta: boolean, desfazendo = false) {
    const anterior = ocultaDe(cat);
    setOcultaOtimista((atual) => ({ ...atual, [cat.id]: oculta })); // otimista
    startSalvar(async () => {
      const r = await onAlternarOculta(cat.id, oculta);
      if (!r.ok) {
        setOcultaOtimista((atual) => ({ ...atual, [cat.id]: anterior })); // rollback
        toast.error(r.erro ?? "Não foi possível atualizar a categoria.");
        return;
      }
      // Sem confirmação ao ocultar (reversível e imediato): o feedback traz o
      // "Desfazer" (mockup §5).
      // O "Desfazer" não abre um segundo toast: o da ação original já avisou.
      if (!desfazendo) {
        if (oculta) {
          toast(`${cat.nome} oculta da vitrine.`, {
            action: { label: "Desfazer", onClick: () => definirOculta(cat, false, true) },
          });
        } else {
          toast.success(`${cat.nome} visível na vitrine.`);
        }
      }
      router.refresh();
    });
  }

  function adicionar() {
    const nome = nova.trim();
    if (!nome) return;
    startSalvar(async () => {
      const r = await onCriar({ nome, ordem: categorias.length });
      if (!r.ok) {
        toast.error(r.erro);
        return;
      }
      toast.success("Categoria criada.");
      setNova("");
      router.refresh();
    });
  }

  function salvarEdicao(id: string, ordem: number) {
    const nome = nomeEdicao.trim();
    if (!nome) return;
    startSalvar(async () => {
      const r = await onAtualizar(id, { nome, ordem });
      if (!r.ok) {
        toast.error(r.erro);
        return;
      }
      toast.success("Categoria atualizada.");
      setEditandoId(null);
      router.refresh();
    });
  }

  function remover(id: string) {
    startSalvar(async () => {
      const r = await onRemover(id);
      if (!r.ok) {
        toast.error(r.erro);
        return;
      }
      toast.success("Categoria removida.");
      router.refresh();
    });
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Categorias de produto</SheetTitle>
          <SheetDescription>
            Agrupam o catálogo na vitrine e definem quais opcionais cada produto
            aceita.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 px-4 pb-4">
          <Separator />

          {/* Nova categoria */}
          <div className="flex items-end gap-2">
            <div className="flex-1 space-y-1">
              <label htmlFor="nova-categoria" className="text-sm font-medium">
                Nova categoria
              </label>
              <Input
                id="nova-categoria"
                value={nova}
                onChange={(e) => setNova(e.target.value)}
                placeholder="Ex.: Pizzas tradicionais"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    adicionar();
                  }
                }}
              />
            </div>
            <Button onClick={adicionar} disabled={salvando || !nova.trim()}>
              {salvando && <Loader2 className="mr-2 size-4 animate-spin" />}
              Adicionar
            </Button>
          </div>

          {/* Lista de categorias existentes */}
          {categorias.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Nenhuma categoria ainda. Crie a primeira acima.
            </p>
          ) : (
            <ul className="divide-y divide-foreground/10">
              {categorias.map((cat, indice) => (
                <li key={cat.id} className="flex flex-col gap-2 py-3">
                  {editandoId === cat.id ? (
                    <div className="flex items-center gap-2">
                      <Input
                        value={nomeEdicao}
                        onChange={(e) => setNomeEdicao(e.target.value)}
                        autoFocus
                        aria-label={`Novo nome de ${cat.nome}`}
                        className="min-h-[44px] flex-1"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            salvarEdicao(cat.id, indice);
                          }
                          if (e.key === "Escape") setEditandoId(null);
                        }}
                      />
                      <Button
                        variant="ghost"
                        className={ALVO}
                        aria-label="Salvar"
                        disabled={salvando}
                        onClick={() => salvarEdicao(cat.id, indice)}
                      >
                        <Check className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        className={ALVO}
                        aria-label="Cancelar"
                        onClick={() => setEditandoId(null)}
                      >
                        <X className="size-4" />
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="flex-1 truncate text-sm font-medium text-foreground">
                        {cat.nome}
                      </span>
                      <Menu>
                        <MenuTrigger
                          render={
                            <Button
                              variant="ghost"
                              className={`${ALVO} shrink-0`}
                              aria-label={`Mais ações de ${cat.nome}`}
                            />
                          }
                        >
                          <MoreVertical aria-hidden className="size-4" />
                        </MenuTrigger>
                        <MenuPortal>
                          <MenuPositioner align="end">
                            <MenuPopup>
                              <MenuItem
                                className="min-h-[44px]"
                                onClick={() => {
                                  setEditandoId(cat.id);
                                  setNomeEdicao(cat.nome);
                                }}
                              >
                                <Pencil aria-hidden className="size-4" />
                                Renomear
                              </MenuItem>
                              <MenuItem
                                className="min-h-[44px]"
                                disabled={salvando}
                                onClick={() => remover(cat.id)}
                              >
                                <Trash2 aria-hidden className="size-4 text-destructive" />
                                Remover
                              </MenuItem>
                            </MenuPopup>
                          </MenuPositioner>
                        </MenuPortal>
                      </Menu>
                    </div>
                  )}

                  {/* Estado da categoria — leitura, redigida no servidor. */}
                  {(ocultaDe(cat) || frequencias[cat.id]?.rotulo != null) && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      {ocultaDe(cat) && (
                        <Badge variant="outline" className="text-muted-foreground">
                          <EyeOff aria-hidden className="size-3" />
                          Oculta da vitrine
                        </Badge>
                      )}
                      <ChipFrequencia rotulo={frequencias[cat.id]?.rotulo} />
                    </div>
                  )}
                  <AvisoFrequencia aviso={frequencias[cat.id]?.aviso} />

                  <Button
                    type="button"
                    variant="outline"
                    className={`${ALVO} w-full justify-start`}
                    aria-label={`Frequência de exibição de ${cat.nome}`}
                    onClick={() => onAbrirFrequencia(cat)}
                  >
                    <Clock aria-hidden className="size-4" />
                    Frequência…
                  </Button>
                  {/* Ligado = APARECE, o mesmo sentido de "Mostrar imagens"
                      (`checked = !oculta`). */}
                  <Label className={`flex ${ALVO} cursor-pointer items-center gap-3 font-normal`}>
                    <Switch
                      checked={!ocultaDe(cat)}
                      disabled={salvando}
                      onCheckedChange={(marcado) => definirOculta(cat, !marcado)}
                    />
                    Mostrar na vitrine
                  </Label>
                  <Label className={`flex ${ALVO} cursor-pointer items-center gap-3 font-normal`}>
                    <Switch
                      checked={exibicaoOtimista[cat.id] ?? cat.exibir_imagens}
                      disabled={salvando}
                      onCheckedChange={() => alternarExibirImagens(cat)}
                    />
                    Mostrar imagens
                  </Label>
                </li>
              ))}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

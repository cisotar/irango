"use client";

import { useState, useTransition, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, Plus, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { BadgeEstadoSistema } from "@/components/vitrine/BadgeStatus";
import {
  schemaModalSazonal,
  type DadosModalSazonal,
} from "@/lib/validacoes/modalSazonal";
import type {
  criarModalSazonal as criarModalSazonalLojista,
  editarModalSazonal as editarModalSazonalLojista,
  ativarModalSazonal as ativarModalSazonalLojista,
  desativarModalSazonal as desativarModalSazonalLojista,
  removerModalSazonal as removerModalSazonalLojista,
} from "@/lib/actions/modalSazonal";
import type { EstadoModalSazonal } from "@/lib/utils/estadoModalSazonal";
import { isoParaDatetimeLocal } from "@/lib/utils/formatarDataLocal";
import {
  montarPayloadModalSazonal,
  type CamposModalSazonal,
} from "./montarPayloadModalSazonal";

/** A régua de `design-system.md` §5: valor LITERAL, nunca a classe semântica. */
const ALVO = "min-h-[44px] min-w-[44px]";

/** Uma opção de checkbox (categoria ou cardápio) da loja. */
export type OpcaoSelecao = { id: string; nome: string };

/** Um cardápio como opção: nome + vigência descrita no servidor (fuso da loja). */
export type OpcaoCardapio = OpcaoSelecao & { vigencia: string };

/** Um modal do lojista, com a seleção e o estado ao vivo já resolvidos no SSR. */
export type ModalSazonalLinha = {
  id: string;
  titulo: string;
  ativo: boolean;
  exibicao_inicio: string;
  exibicao_fim: string;
  mostrar_promocoes_junto: boolean;
  categorias: string[];
  cardapios: string[];
  /** Derivado no SERVIDOR, a cada request — preview de UX, nada depende dele. */
  estado: EstadoModalSazonal;
};

export type AcoesModalSazonal = {
  criar: typeof criarModalSazonalLojista;
  editar: typeof editarModalSazonalLojista;
  ativar: typeof ativarModalSazonalLojista;
  desativar: typeof desativarModalSazonalLojista;
  remover: typeof removerModalSazonalLojista;
};


/**
 * [302] `/painel/configuracoes/promocoes` — casca fina sobre `Card`, `Button`,
 * `Switch`, `Checkbox` e `AlertDialog`.
 *
 * Nada de estado ao vivo é calculado aqui: `estado` chega pronto do Server
 * Component, recalculado a cada request. Nenhum `setInterval`, nenhum relógio do
 * browser — o painel nunca decide se um modal está no ar.
 *
 * O `schemaModalSazonal` (o MESMO do servidor) valida no submit só como gate de
 * UX; a autoridade é a Server Action, que revalida, deriva `loja_id` do dono e
 * grava sob a RLS. O título é renderizado como TEXTO do React (escape
 * automático), nunca `dangerouslySetInnerHTML` (RN-01).
 */
export function PromocoesClient({
  modais,
  categorias,
  cardapios,
  acoes,
}: {
  modais: ModalSazonalLinha[];
  categorias: OpcaoSelecao[];
  cardapios: OpcaoCardapio[];
  acoes: AcoesModalSazonal;
}): ReactElement {
  const router = useRouter();

  // `null` = form fechado; `"novo"` = criando; um modal = editando aquele.
  const [editando, setEditando] = useState<ModalSazonalLinha | "novo" | null>(
    null,
  );
  const [aRemover, setARemover] = useState<ModalSazonalLinha | null>(null);
  const [pendente, startTransicao] = useTransition();

  function abrirNovo(): void {
    setEditando("novo");
  }

  async function alternarAtivo(
    modal: ModalSazonalLinha,
    ligar: boolean,
  ): Promise<void> {
    const resultado = ligar
      ? await acoes.ativar(modal.id)
      : await acoes.desativar(modal.id);
    if (!resultado.ok) {
      toast.error(resultado.erro);
      return;
    }
    // Ligar um desativa o anterior automaticamente (RN-05) — avisamos para o
    // lojista não achar que "sumiu" o modal que estava no ar.
    toast.success(
      ligar
        ? "Modal ativado. Qualquer outro modal ativo foi desativado."
        : "Modal desativado. A configuração ficou salva como rascunho.",
    );
    router.refresh();
  }

  function confirmarRemocao(): void {
    if (aRemover == null) return;
    const modal = aRemover;
    startTransicao(async () => {
      const resultado = await acoes.remover(modal.id);
      if (!resultado.ok) {
        toast.error(resultado.erro);
        return;
      }
      toast.success("Modal removido.");
      setARemover(null);
      if (editando !== "novo" && editando?.id === modal.id) setEditando(null);
      router.refresh();
    });
  }

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-heading text-xl font-semibold text-foreground">
          Promoções da vitrine
        </h1>
        {editando === null ? (
          <Button type="button" className={ALVO} onClick={abrirNovo}>
            <Plus aria-hidden className="size-4" />
            Novo modal
          </Button>
        ) : null}
      </div>

      <p className="mb-4 text-sm text-muted-foreground">
        Um modal de divulgação aparece na primeira visita do dia à sua loja, com
        um título e os pratos que você escolher. Só um modal fica no ar por vez —
        ativar um desativa o anterior.
      </p>

      {/* Painel de controle dos modais já existentes. */}
      {modais.length === 0 ? (
        <Card className="mb-4">
          <CardContent className="flex flex-col items-start gap-2 p-6">
            <p className="font-medium text-foreground">Nenhum modal ainda.</p>
            <p className="text-sm text-muted-foreground">
              Crie um modal para anunciar uma temporada — “Cardápio de Inverno”,
              “Especial de Dia das Mães” — na abertura da sua vitrine.
            </p>
          </CardContent>
        </Card>
      ) : (
        <ul className="mb-6 flex flex-col gap-3">
          {modais.map((modal) => (
            <li key={modal.id}>
              <Card>
                <CardContent className="flex flex-col gap-3 p-6">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex flex-col gap-1">
                      {/* Título como TEXTO do React (RN-01): escape automático. */}
                      <span className="font-semibold text-foreground">
                        {modal.titulo}
                      </span>
                      <div>
                        <BadgeEstadoSistema
                          tom={modal.estado.tom}
                          rotulo={modal.estado.rotulo}
                        />
                      </div>
                    </div>

                    <label className={`flex ${ALVO} items-center gap-2 text-sm`}>
                      <Switch
                        checked={modal.ativo}
                        disabled={pendente}
                        onCheckedChange={(marcado) =>
                          void alternarAtivo(modal, marcado === true)
                        }
                        aria-label={`Ativar ou desativar o modal ${modal.titulo}`}
                      />
                      {modal.ativo ? "Ativo" : "Rascunho"}
                    </label>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      className={ALVO}
                      onClick={() => setEditando(modal)}
                    >
                      <Pencil aria-hidden className="size-4" />
                      Editar
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      className={ALVO}
                      onClick={() => setARemover(modal)}
                    >
                      Remover
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {/* Formulário de criação/edição, ABAIXO do painel de controle. */}
      {editando !== null ? (
        <Card>
          <CardContent className="p-6">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="font-heading text-lg font-semibold text-foreground">
                {editando === "novo" ? "Novo modal" : "Editar modal"}
              </h2>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Fechar formulário"
                onClick={() => setEditando(null)}
              >
                <X className="size-4" />
              </Button>
            </div>

            <FormModalSazonal
              key={editando === "novo" ? "novo" : editando.id}
              inicial={editando === "novo" ? null : editando}
              categorias={categorias}
              cardapios={cardapios}
              onSubmit={async (payload) =>
                editando === "novo"
                  ? acoes.criar(payload)
                  : acoes.editar(editando.id, payload)
              }
              onSucesso={() => {
                setEditando(null);
                router.refresh();
              }}
            />
          </CardContent>
        </Card>
      ) : null}

      <AlertDialog
        open={aRemover !== null}
        onOpenChange={(aberto) => {
          if (!aberto) setARemover(null);
        }}
      >
        <AlertDialogContent>
          {aRemover !== null ? (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  Remover “{aRemover.titulo}”?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  O modal e a seleção de categorias e cardápios dele são
                  apagados. Os produtos, categorias e cardápios continuam
                  existindo.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className={ALVO}>
                  Cancelar
                </AlertDialogCancel>
                <Button
                  type="button"
                  variant="destructive"
                  className={ALVO}
                  disabled={pendente}
                  onClick={confirmarRemocao}
                >
                  {pendente && (
                    <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
                  )}
                  Remover modal
                </Button>
              </AlertDialogFooter>
            </>
          ) : null}
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}

/**
 * O formulário de um modal. `react-hook-form` seria um exagero para seis campos
 * de estado local — o padrão do painel (`FormCupom`, `PerfilClient`) é `useState`
 * + `schema.safeParse` no submit, e é o que seguimos. O `schemaModalSazonal` (o
 * MESMO da Server Action) é o gate de UX; a autoridade é o servidor.
 */
function FormModalSazonal({
  inicial,
  categorias,
  cardapios,
  onSubmit,
  onSucesso,
}: {
  /** `null` = criação; um modal = edição pré-preenchida. */
  inicial: ModalSazonalLinha | null;
  categorias: OpcaoSelecao[];
  cardapios: OpcaoCardapio[];
  onSubmit: (
    payload: DadosModalSazonal,
  ) => Promise<{ ok: true } | { ok: false; erro: string }>;
  onSucesso: () => void;
}): ReactElement {
  const [titulo, setTitulo] = useState(inicial?.titulo ?? "");
  const [exibicaoInicio, setExibicaoInicio] = useState(
    isoParaDatetimeLocal(inicial?.exibicao_inicio ?? null),
  );
  const [exibicaoFim, setExibicaoFim] = useState(
    isoParaDatetimeLocal(inicial?.exibicao_fim ?? null),
  );
  const [categoriasSel, setCategoriasSel] = useState<string[]>(
    inicial?.categorias ?? [],
  );
  const [cardapiosSel, setCardapiosSel] = useState<string[]>(
    inicial?.cardapios ?? [],
  );
  const [mostrarPromocoesJunto, setMostrarPromocoesJunto] = useState(
    inicial?.mostrar_promocoes_junto ?? false,
  );
  const [enviando, startEnvio] = useTransition();

  function alternar(
    lista: string[],
    set: (v: string[]) => void,
    id: string,
    marcado: boolean,
  ): void {
    set(marcado ? [...new Set([...lista, id])] : lista.filter((x) => x !== id));
  }

  function salvar(): void {
    const campos: CamposModalSazonal = {
      titulo,
      exibicaoInicio,
      exibicaoFim,
      categorias: categoriasSel,
      cardapios: cardapiosSel,
      mostrarPromocoesJunto,
    };
    const parsed = schemaModalSazonal.safeParse(montarPayloadModalSazonal(campos));
    if (!parsed.success) {
      // A primeira issue do zod já é a mensagem em português (schema 301).
      toast.error(
        parsed.error.issues[0]?.message ?? "Confira os campos do modal.",
      );
      return;
    }

    startEnvio(async () => {
      const resultado = await onSubmit(parsed.data);
      if (!resultado.ok) {
        toast.error(resultado.erro);
        return;
      }
      toast.success("Modal salvo!");
      onSucesso();
    });
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        salvar();
      }}
    >
      <div className="space-y-1">
        <Label htmlFor="modal-titulo">Título</Label>
        <Input
          id="modal-titulo"
          value={titulo}
          onChange={(e) => setTitulo(e.target.value)}
          placeholder="Ex.: Chegou o Cardápio de Inverno"
          maxLength={120}
          required
        />
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="modal-inicio">Aparece a partir de</Label>
          <Input
            id="modal-inicio"
            type="datetime-local"
            value={exibicaoInicio}
            onChange={(e) => setExibicaoInicio(e.target.value)}
            required
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="modal-fim">Deixa de aparecer em</Label>
          <Input
            id="modal-fim"
            type="datetime-local"
            value={exibicaoFim}
            onChange={(e) => setExibicaoFim(e.target.value)}
            required
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Esta é a janela em que o modal aparece na vitrine — separada da vigência
        dos cardápios que você divulgar.
      </p>

      <Separator />

      <fieldset className="space-y-2">
        <legend className="font-medium text-foreground">
          Categorias a divulgar
        </legend>
        {categorias.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Nenhuma categoria cadastrada ainda.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {categorias.map((categoria) => {
              const marcado = categoriasSel.includes(categoria.id);
              return (
                <li key={categoria.id}>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={marcado}
                      onCheckedChange={(v) =>
                        alternar(
                          categoriasSel,
                          setCategoriasSel,
                          categoria.id,
                          v === true,
                        )
                      }
                    />
                    <span className="text-foreground">{categoria.nome}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="font-medium text-foreground">
          Cardápios a divulgar
        </legend>
        {cardapios.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Nenhum cardápio cadastrado ainda.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {cardapios.map((cardapio) => {
              const marcado = cardapiosSel.includes(cardapio.id);
              return (
                <li key={cardapio.id}>
                  <label className="flex items-start gap-2 text-sm">
                    <Checkbox
                      className="mt-0.5"
                      checked={marcado}
                      onCheckedChange={(v) =>
                        alternar(
                          cardapiosSel,
                          setCardapiosSel,
                          cardapio.id,
                          v === true,
                        )
                      }
                    />
                    <span className="flex flex-col">
                      <span className="text-foreground">{cardapio.nome}</span>
                      <span className="text-xs text-muted-foreground">
                        {cardapio.vigencia}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </fieldset>

      <p className="text-xs text-muted-foreground">
        Escolha ao menos uma categoria ou um cardápio para o modal ter o que
        mostrar.
      </p>

      <Separator />

      {/* Toggle "mostrar promoções junto" (RN-09): quando este modal está no ar,
          o modal de promoções também abre? Preferência de UX do lojista. */}
      <div className="space-y-1">
        <div className="flex min-h-11 items-center justify-between gap-3">
          <Label htmlFor="modal-promocoes-junto" className="cursor-pointer">
            Mostrar as promoções junto
          </Label>
          <div className="flex shrink-0 items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {mostrarPromocoesJunto ? "Ligado" : "Desligado"}
            </span>
            <Switch
              id="modal-promocoes-junto"
              checked={mostrarPromocoesJunto}
              onCheckedChange={(v) => setMostrarPromocoesJunto(v === true)}
              aria-describedby="modal-promocoes-junto-ajuda"
            />
          </div>
        </div>
        <p
          id="modal-promocoes-junto-ajuda"
          className="text-xs text-muted-foreground"
        >
          Com este modal no ar, o aviso de pratos em promoção também aparece na
          abertura da loja. Desligado, só este modal aparece.
        </p>
      </div>

      <Separator />

      <Button type="submit" className="w-full" disabled={enviando}>
        {enviando && <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />}
        Salvar
      </Button>
    </form>
  );
}

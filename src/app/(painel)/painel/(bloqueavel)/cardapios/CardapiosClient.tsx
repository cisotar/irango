"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactElement } from "react";
import { toast } from "sonner";
import { AlertTriangle, Pencil, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
  frasesDoImpacto,
  rotuloConverter,
} from "@/components/painel/frasesCardapio";
import {
  FRASE_CONFIRMAR_DEVOLUCAO,
  avisoCardapioEscondendo,
  rotuloDevolverAoMenu,
  rotuloReligarOuEstender,
  tituloDevolverAoMenu,
} from "@/lib/utils/copiaCardapioPainel";
import type { EstadoCardapio } from "@/lib/utils/estadoCardapioPainel";

/** A régua de `design-system.md` §5: valor LITERAL, nunca a classe
 *  semântica do Tailwind (com base de fonte 120% ela não dá 44px). */
const ALVO = "min-h-[44px] min-w-[44px]";

export type LinhaCardapio = {
  id: string;
  nome: string;
  ativo: boolean;
  /** Derivado no SERVIDOR, a cada request (design §13.3 regra 3). */
  estado: EstadoCardapio;
  /** `descreverVigencia` — nenhuma redação de janela escrita no JSX. */
  descricao: string;
  /** Produtos do menu vinculados (D14). */
  menu: number;
  /** Exclusivos que sumiriam da vitrine (D14). */
  exclusivos: number;
  /**
   * [264/RN-12] Os dois números do aviso, de `contarProdutosEscondidos` —
   * PREVIEW DE UX recalculado no servidor a cada request. Nenhuma decisão
   * depende deles; o cliente não os envia de volta.
   */
  escondidos: { doMenu: number; sumidos: number };
  /** Os nomes dos sumidos, para o `AlertDialog` NOMEAR quem será devolvido. */
  nomesEscondidos: string[];
  /** Os ids correspondentes, na mesma ordem — o conjunto exato a converter. */
  idsEscondidos: string[];
};

export type AcoesCardapios = {
  ligarDesligar: (
    id: string,
    ativo: boolean,
  ) => Promise<{ ok: true } | { ok: false; erro: string }>;
  remover: (
    id: string,
  ) => Promise<{ ok: true } | { ok: false; erro: string; exclusivos: number }>;
  converter: (
    cardapioId: string,
  ) => Promise<{ ok: true } | { ok: false; erro: string }>;
  /**
   * [264] Devolve ao menu EXATAMENTE os produtos nomeados no diálogo. O
   * `loja_id` sai de `buscarLojaDoDono` dentro da action e a RLS decide; a
   * lista de ids é só o recorte. Nada é convertido sem este gesto — o sistema
   * não mexe em venda por conta própria (RN-12).
   */
  devolverAoMenu: (
    payload: unknown,
  ) => Promise<{ ok: true } | { ok: false; erro: string }>;
};

type Confirmacao =
  | { tipo: "desligar"; linha: LinhaCardapio }
  | { tipo: "remover"; linha: LinhaCardapio }
  | { tipo: "devolver"; linha: LinhaCardapio };

type Recusa = { mensagem: string; exclusivos: number };

/**
 * [256] A lista de `/painel/cardapios` — casca fina sobre `Card`, `Button`,
 * `Switch` e `AlertDialog`.
 *
 * Nada de estado é calculado aqui: `estado` e `descricao` chegam prontos do
 * Server Component, recalculados a cada request. Nenhum `setInterval`, nenhum
 * relógio do browser — o painel nunca decide se um cardápio está aberto.
 */
export function CardapiosClient({
  cardapios,
  baseCardapios,
  acoes,
}: {
  cardapios: LinhaCardapio[];
  /**
   * [269] A BASE das rotas de cardápio deste mundo: a do lojista no painel, a
   * da loja-alvo no hub admin.
   *
   * OBRIGATÓRIA e sem default (issue 160), pelo mesmo motivo de `hrefCardapios`
   * no `ProdutosClient`: com a rota escrita aqui dentro, o admin que edita a
   * loja de um terceiro cairia no painel da PRÓPRIA loja dele e criaria o
   * cardápio na loja errada — o bug que já voltou duas vezes (`8bfe902`,
   * `f26cc6a`). Quem sabe qual rota existe é o Server Component, não este
   * componente de apresentação.
   */
  baseCardapios: string;
  acoes: AcoesCardapios;
}): ReactElement {
  const router = useRouter();
  const [confirmacao, setConfirmacao] = useState<Confirmacao | null>(null);
  const [recusa, setRecusa] = useState<Recusa | null>(null);
  const [pendente, setPendente] = useState(false);

  function fechar(): void {
    setConfirmacao(null);
    setRecusa(null);
  }

  async function ligar(linha: LinhaCardapio, ativo: boolean): Promise<void> {
    // Ligar é reversível e não esconde nada: vai direto. Só DESLIGAR passa
    // pelo diálogo, porque é ele que tira produto exclusivo da vitrine.
    const resultado = await acoes.ligarDesligar(linha.id, ativo);
    if (!resultado.ok) {
      toast.error(resultado.erro);
      return;
    }
    toast.success(ativo ? "Cardápio ligado." : "Cardápio desligado.");
    router.refresh();
  }

  async function confirmarDesligar(linha: LinhaCardapio): Promise<void> {
    setPendente(true);
    try {
      await ligar(linha, false);
      fechar();
    } finally {
      setPendente(false);
    }
  }

  async function confirmarRemover(linha: LinhaCardapio): Promise<void> {
    setPendente(true);
    try {
      const resultado = await acoes.remover(linha.id);
      if (!resultado.ok) {
        // A recusa de RN-14 aparece NO MESMO diálogo, com a saída a um clique
        // logo abaixo — nunca como toast depois do clique, que deixaria o
        // lojista sem saber o que fazer a seguir.
        setRecusa({
          mensagem: resultado.erro,
          exclusivos: resultado.exclusivos,
        });
        return;
      }
      toast.success("Cardápio removido.");
      fechar();
      router.refresh();
    } finally {
      setPendente(false);
    }
  }

  async function devolverAoMenu(linha: LinhaCardapio): Promise<void> {
    setPendente(true);
    try {
      const resultado = await acoes.devolverAoMenu({
        produto_ids: linha.idsEscondidos,
        visibilidade: "menu",
      });
      if (!resultado.ok) {
        toast.error(resultado.erro);
        return;
      }
      toast.success("Produtos devolvidos ao menu.");
      fechar();
      router.refresh();
    } finally {
      setPendente(false);
    }
  }

  async function converter(linha: LinhaCardapio): Promise<void> {
    setPendente(true);
    try {
      const resultado = await acoes.converter(linha.id);
      if (!resultado.ok) {
        setRecusa({ mensagem: resultado.erro, exclusivos: 0 });
        return;
      }
      toast.success("Produtos convertidos para o menu.");
      setRecusa(null);
      router.refresh();
    } finally {
      setPendente(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Cardápios</h1>
        <Button
          className={ALVO}
          render={
            <Link href={`${baseCardapios}/novo`}>
              <Plus aria-hidden />
              Novo cardápio
            </Link>
          }
        />
      </div>

      {cardapios.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-start gap-2">
            <p className="font-medium">Nenhum cardápio ainda.</p>
            <p className="text-sm text-texto-muted">
              Um cardápio agrupa pratos que aparecem só em certos dias, horários
              ou períodos — feijoada de sábado, menu de Natal, almoço executivo.
            </p>
          </CardContent>
        </Card>
      ) : null}

      <ul className="flex flex-col gap-3">
        {cardapios.map((linha) => (
          <li key={linha.id}>
            <Card>
              <CardContent className="flex flex-col gap-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex flex-col gap-1">
                    <span className="font-semibold">{linha.nome}</span>
                    <div>
                      <BadgeEstadoSistema
                        tom={linha.estado.tom}
                        rotulo={linha.estado.rotulo}
                        rotuloAcessivel={linha.estado.rotuloAcessivel}
                      />
                      {linha.estado.abertoAgora ? (
                        <p className="mt-1 text-xs text-texto-muted">
                          aparecendo como seção no topo da sua loja
                        </p>
                      ) : null}
                    </div>
                    <p className="text-sm text-texto-muted">{linha.descricao}</p>
                  </div>

                  <label
                    className={`flex ${ALVO} items-center gap-2 text-sm`}
                  >
                    <Switch
                      checked={linha.ativo}
                      onCheckedChange={(marcado) => {
                        if (marcado) void ligar(linha, true);
                        else setConfirmacao({ tipo: "desligar", linha });
                      }}
                      aria-label={`Ligar ou desligar o cardápio ${linha.nome}`}
                    />
                    {linha.ativo ? "Ligado" : "Desligado"}
                  </label>
                </div>

                <AvisoEscondendo
                  linha={linha}
                  editarHref={`${baseCardapios}/${linha.id}`}
                  aoReligar={() => void ligar(linha, true)}
                  aoDevolver={() => setConfirmacao({ tipo: "devolver", linha })}
                />

                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    className={ALVO}
                    render={
                      <Link href={`${baseCardapios}/${linha.id}`}>
                        <Pencil aria-hidden />
                        Editar
                      </Link>
                    }
                  />
                  <Button
                    type="button"
                    variant="destructive"
                    className={ALVO}
                    onClick={() => setConfirmacao({ tipo: "remover", linha })}
                  >
                    Remover
                  </Button>
                </div>
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>

      <AlertDialog
        open={confirmacao !== null}
        onOpenChange={(aberto) => {
          if (!aberto) fechar();
        }}
      >
        <AlertDialogContent>
          {confirmacao !== null ? (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {confirmacao.tipo === "desligar"
                    ? `Desligar “${confirmacao.linha.nome}”?`
                    : confirmacao.tipo === "remover"
                      ? `Remover “${confirmacao.linha.nome}”?`
                      : tituloDevolverAoMenu(
                          confirmacao.linha.escondidos.sumidos,
                        )}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {confirmacao.tipo === "desligar"
                    ? "O cardápio sai do ar, mas dias, horários e prazo continuam gravados: um clique traz tudo de volta."
                    : confirmacao.tipo === "remover"
                      ? "O cardápio e os vínculos dele com os produtos são apagados. Os produtos continuam existindo."
                      : FRASE_CONFIRMAR_DEVOLUCAO}
                </AlertDialogDescription>
              </AlertDialogHeader>

              {/* [264] A devolução NOMEIA os produtos afetados (design §13.4
                  item 3): confirmação destrutiva sempre diz o que será
                  mexido. Nos outros dois gestos, as frases de impacto de 256. */}
              <ul className="flex list-disc flex-col gap-1 pl-4 text-sm">
                {(confirmacao.tipo === "devolver"
                  ? confirmacao.linha.nomesEscondidos
                  : frasesDoImpacto(
                      confirmacao.linha.menu,
                      confirmacao.linha.exclusivos,
                    )
                ).map((frase) => (
                  <li key={frase}>{frase}</li>
                ))}
              </ul>

              {recusa !== null ? (
                <div
                  role="alert"
                  className="flex flex-col items-start gap-2 rounded-lg border border-amber-300 bg-amber-100 p-3 text-sm text-amber-900"
                >
                  <p>{recusa.mensagem}</p>
                  {recusa.exclusivos > 0 ? (
                    <Button
                      type="button"
                      variant="outline"
                      className={ALVO}
                      disabled={pendente}
                      onClick={() => void converter(confirmacao.linha)}
                    >
                      {rotuloConverter(recusa.exclusivos)}
                    </Button>
                  ) : null}
                </div>
              ) : null}

              <AlertDialogFooter>
                <AlertDialogCancel className={ALVO}>Cancelar</AlertDialogCancel>
                <Button
                  type="button"
                  variant={
                    confirmacao.tipo === "devolver" ? "default" : "destructive"
                  }
                  className={ALVO}
                  disabled={pendente}
                  onClick={() => {
                    if (confirmacao.tipo === "desligar") {
                      void confirmarDesligar(confirmacao.linha);
                    } else if (confirmacao.tipo === "remover") {
                      void confirmarRemover(confirmacao.linha);
                    } else {
                      void devolverAoMenu(confirmacao.linha);
                    }
                  }}
                >
                  {confirmacao.tipo === "desligar"
                    ? "Desligar cardápio"
                    : confirmacao.tipo === "remover"
                      ? "Remover cardápio"
                      : rotuloDevolverAoMenu(
                          confirmacao.linha.escondidos.sumidos,
                        )}
                </Button>
              </AlertDialogFooter>
            </>
          ) : null}
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/**
 * [264/RN-12] O aviso de cardápio expirado ou desligado escondendo produtos.
 *
 * **Âmbar, nunca vermelho** (design §13.4 item 4): requer ação do lojista, não
 * é falha — vermelho num cardápio de temporada encerrada ensina o lojista a
 * ignorar vermelho. Ícone **+ texto**, nunca só a cor (WCAG 1.4.1).
 *
 * A ordem das linhas é da copy pura (`avisoCardapioEscondendo`), não daqui: é
 * lá que ela está travada por teste. Nada sumiu ⇒ o componente inteiro some.
 */
function AvisoEscondendo({
  linha,
  editarHref,
  aoReligar,
  aoDevolver,
}: {
  linha: LinhaCardapio;
  /** [269] Derivado de `baseCardapios` pelo chamador — nunca escrito aqui. */
  editarHref: string;
  aoReligar: () => void;
  aoDevolver: () => void;
}): ReactElement | null {
  const linhas = avisoCardapioEscondendo(linha.escondidos);
  if (linhas === null) return null;

  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
        <div className="flex flex-col gap-0.5">
          {linhas.map((frase, indice) => (
            <p key={frase} className={indice === 0 ? "font-medium" : undefined}>
              {frase}
            </p>
          ))}
        </div>
      </div>

      {/* As duas saídas a um clique. Nenhuma das duas roda sozinha: religar é
          um gesto do lojista e devolver abre confirmação nomeando os produtos.
          O sistema nunca converte `visibilidade` por conta própria. */}
      <div className="flex flex-wrap gap-2">
        {linha.ativo ? (
          <Button
            variant="outline"
            className={ALVO}
            render={
              <Link href={editarHref}>
                {rotuloReligarOuEstender(true)}
              </Link>
            }
          />
        ) : (
          <Button
            type="button"
            variant="outline"
            className={ALVO}
            onClick={aoReligar}
          >
            {rotuloReligarOuEstender(false)}
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          className={ALVO}
          onClick={aoDevolver}
        >
          {rotuloDevolverAoMenu(linha.escondidos.sumidos)}
        </Button>
      </div>
    </div>
  );
}

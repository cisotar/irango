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
  fraseArquivar,
  fraseCascataPermanente,
  frasesDoImpacto,
  rotuloArquivar,
  rotuloConfirmarCascata,
  rotuloConverter,
  rotuloRemoverProdutos,
} from "@/components/painel/frasesCardapio";
import type { ModoRemocaoExclusivos } from "@/lib/actions/cardapio-contrato";
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
  /**
   * [285] O modo é OPCIONAL: ausente ⇒ `"manter"` na action (RN-10), o
   * comportamento de hoje byte a byte. Só o gesto explícito do lojista no
   * bloco de recusa manda `"arquivar"` ou `"cascata"` — o cliente envia o
   * MODO e nada mais: a lista de produtos afetados é recalculada no servidor
   * (RN-02), nunca sobe daqui.
   */
  remover: (
    id: string,
    modo?: ModoRemocaoExclusivos,
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

/**
 * [285] As duas etapas do bloco de recusa. `"escolha"` oferece as três saídas
 * (converter, arquivar, remover produtos); `"cascata"` é a SEGUNDA
 * confirmação, que só o botão destrutivo abre.
 *
 * Mora no estado do PAI (e não dentro do bloco) por dois motivos: fechar o
 * diálogo zera a etapa junto com a recusa — ninguém reabre já armado no gesto
 * irreversível — e o bloco fica puro, afirmável por `renderToStaticMarkup`
 * sem jsdom, que é a única forma de travar este markup neste projeto.
 */
export type EtapaRecusa = "escolha" | "cascata";

type Recusa = { mensagem: string; exclusivos: number; etapa: EtapaRecusa };

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

  /**
   * [285] O único caminho de remoção — os três modos passam por aqui. O que
   * muda entre eles é só o literal do modo e o toast de sucesso; a recusa,
   * o `refresh` e o `pendente` são os mesmos.
   */
  async function remover(
    linha: LinhaCardapio,
    modo: ModoRemocaoExclusivos,
    sucesso: string,
  ): Promise<void> {
    setPendente(true);
    try {
      const resultado = await acoes.remover(linha.id, modo);
      if (!resultado.ok) {
        // A recusa de RN-14 aparece NO MESMO diálogo, com as saídas a um
        // clique logo abaixo — nunca como toast depois do clique, que
        // deixaria o lojista sem saber o que fazer a seguir.
        setRecusa({
          mensagem: resultado.erro,
          exclusivos: resultado.exclusivos,
          etapa: "escolha",
        });
        return;
      }
      toast.success(sucesso);
      fechar();
      router.refresh();
    } finally {
      setPendente(false);
    }
  }

  async function confirmarRemover(linha: LinhaCardapio): Promise<void> {
    // RN-10: o gesto de sempre continua sendo `"manter"`.
    await remover(linha, "manter", "Cardápio removido.");
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
        setRecusa({ mensagem: resultado.erro, exclusivos: 0, etapa: "escolha" });
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
                <BlocoRecusa
                  mensagem={recusa.mensagem}
                  exclusivos={recusa.exclusivos}
                  etapa={recusa.etapa}
                  pendente={pendente}
                  aoConverter={() => void converter(confirmacao.linha)}
                  aoArquivar={() =>
                    void remover(
                      confirmacao.linha,
                      "arquivar",
                      "Produtos arquivados e cardápio removido.",
                    )
                  }
                  aoPedirCascata={() =>
                    setRecusa({ ...recusa, etapa: "cascata" })
                  }
                  aoDesistirDaCascata={() =>
                    setRecusa({ ...recusa, etapa: "escolha" })
                  }
                  aoConfirmarCascata={() =>
                    void remover(
                      confirmacao.linha,
                      "cascata",
                      "Produtos apagados e cardápio removido.",
                    )
                  }
                />
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

/**
 * [285/RN-14] O bloco âmbar da recusa da remoção — as três saídas que o
 * lojista tem quando o cardápio tem produto exclusivo, mais a segunda
 * confirmação da cascata.
 *
 * **Âmbar, nunca vermelho** (design §13.4 item 4): a recusa pede uma decisão,
 * não denuncia uma falha. O único vermelho aqui é o do BOTÃO destrutivo.
 *
 * Componente puro e EXPORTADO de propósito: sem jsdom neste projeto, o
 * conteúdo de um `AlertDialog` fechado não é observável, e travar este markup
 * por teste exige renderizá-lo direto (`renderToStaticMarkup`). `etapa` é
 * prop, não estado interno, pelo mesmo motivo — e porque fechar o diálogo
 * precisa zerá-la junto com a recusa.
 *
 * Nenhum dos três gestos decide nada: quem autoriza é a RLS (lojista) ou o
 * escopo por `loja_id` (admin), e QUEM é afetado é recalculado no servidor
 * (RN-02). Daqui sobe só o modo.
 */
export function BlocoRecusa({
  mensagem,
  exclusivos,
  etapa,
  pendente,
  aoConverter,
  aoArquivar,
  aoPedirCascata,
  aoDesistirDaCascata,
  aoConfirmarCascata,
}: {
  mensagem: string;
  /** Quantos exclusivos o SERVIDOR contou nesta mesma resposta (preview). */
  exclusivos: number;
  etapa: EtapaRecusa;
  pendente: boolean;
  aoConverter: () => void;
  aoArquivar: () => void;
  /** Só TROCA de etapa — o botão destrutivo não escreve nada no banco. */
  aoPedirCascata: () => void;
  aoDesistirDaCascata: () => void;
  aoConfirmarCascata: () => void;
}): ReactElement {
  const classe =
    "flex flex-col items-start gap-2 rounded-lg border border-amber-300 bg-amber-100 p-3 text-sm text-amber-900";

  // A segunda confirmação SUBSTITUI o bloco: deixar os três botões à vista
  // junto do irreversível convidaria o clique errado.
  if (etapa === "cascata") {
    return (
      <div role="alert" className={classe}>
        <p className="font-medium">{fraseCascataPermanente(exclusivos)}</p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            className={ALVO}
            disabled={pendente}
            onClick={aoDesistirDaCascata}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            variant="destructive"
            className={ALVO}
            disabled={pendente}
            onClick={aoConfirmarCascata}
          >
            {rotuloConfirmarCascata(exclusivos)}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div role="alert" className={classe}>
      <p>{mensagem}</p>
      {exclusivos > 0 ? (
        <>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              className={ALVO}
              disabled={pendente}
              onClick={aoConverter}
            >
              {rotuloConverter(exclusivos)}
            </Button>
            <Button
              type="button"
              variant="outline"
              className={ALVO}
              disabled={pendente}
              onClick={aoArquivar}
            >
              {rotuloArquivar(exclusivos)}
            </Button>
            <Button
              type="button"
              variant="destructive"
              className={ALVO}
              disabled={pendente}
              onClick={aoPedirCascata}
            >
              {rotuloRemoverProdutos(exclusivos)}
            </Button>
          </div>
          {/* Arquivar é o gesto do meio e o menos óbvio dos três: sem esta
              linha, "arquivar" e "remover" soam iguais para quem não conhece
              o jargão. */}
          <p className="text-xs">{fraseArquivar(exclusivos)}</p>
        </>
      ) : null}
    </div>
  );
}

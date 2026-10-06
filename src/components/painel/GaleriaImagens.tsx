"use client";

import { useRef, useState, type ChangeEvent, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Upload } from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CabecalhoPagina } from "@/components/painel/CabecalhoPagina";
import { GradeImagens } from "@/components/painel/GradeImagens";
import {
  alternarSelecao,
  anexarPagina,
  atingiuTeto,
  descreverRemocao,
  idsEmUso,
  incluirNoInicio,
  interrompeFila,
  MSG_LIMITE_SELECAO,
  resumoEnvio,
  rotuloContador,
  rotuloProgressoEnvio,
  rotuloSelecao,
  tirarIds,
} from "@/components/painel/estadoGaleria";
import { CAMPO_ARQUIVO } from "@/lib/actions/upload-contrato";
import {
  CAMPO_MINIATURA,
  MSG_ENVIO_FALHOU,
  MSG_REMOCAO_FALHOU,
  MSG_TETO,
  MSG_USO_FALHOU,
  mensagemResultadoRemocao,
  type CursorGaleria,
  type ImagemGaleria,
  type PaginaGaleria,
  type ResultadoEnvioGaleria,
  type ResultadoListagemGaleria,
  type ResultadoRemocao,
  type ResultadoUsoImagens,
  type UsoImagem,
} from "@/lib/actions/galeria-contrato";
import { prepararImagemParaGaleria } from "@/lib/utils/reducaoImagem";
import {
  TAMANHO_MAXIMO_BYTES,
  TIPOS_IMAGEM_PERMITIDOS,
  validarImagem,
  validarMagicBytes,
} from "@/lib/utils/validarImagem";

/** A régua de `design-system.md` §5: valor LITERAL, nunca `min-h-11`. */
const ALVO = "min-h-[44px] min-w-[44px]";

/**
 * Server Actions da galeria. TODAS obrigatórias e sem default (regra da issue
 * 160, `seguranca.md` §7): o painel injeta as do lojista (loja do auth) e o hub
 * admin as variantes `*Admin` com o `lojaId` da URL fixado em closure. Uma
 * chave esquecida não compila — nunca cai, em silêncio, na loja de quem está
 * logado.
 */
export type AcoesGaleriaImagens = {
  enviarImagem: (formData: FormData) => Promise<ResultadoEnvioGaleria>;
  listarMais: (cursor: CursorGaleria) => Promise<ResultadoListagemGaleria>;
  consultarUso: (ids: string[]) => Promise<ResultadoUsoImagens>;
  remover: (ids: string[]) => Promise<ResultadoRemocao>;
};

export type GaleriaImagensProps = {
  voltarHref: string;
  voltarRotulo: string;
  /** Primeira página (servidor). */
  imagensIniciais: ImagemGaleria[];
  cursorInicial: CursorGaleria | null;
  /** Originais não pendentes da loja (servidor). Na tela é prévia. */
  totalInicial: number;
  /** Uso da primeira página, para o selo "Em uso". */
  usosIniciais: UsoImagem[];
  acoes: AcoesGaleriaImagens;
};

type ItemFila = {
  nome: string;
  estado: "aguardando" | "enviando" | "enviada" | "erro";
  erro?: string;
};

type Fila = { itens: ItemFila[]; rodando: boolean };

/**
 * Gate de UX de um arquivo antes de reduzir (o servidor revalida tudo).
 *
 * O tamanho do arquivo CRU não é barrado aqui: a original é reduzida no
 * navegador (P4) justamente para que a foto de 6 MB do celular caiba nos 2 MB
 * do bucket. O limite de tamanho é aplicado depois, nos arquivos reduzidos
 * (`prepararImagemParaGaleria`). Aqui valem o tipo declarado, arquivo vazio e o
 * conteúdo real (magic bytes).
 */
async function validarArquivo(arquivo: File): Promise<string | null> {
  const meta = validarImagem({
    tipo: arquivo.type,
    tamanho: Math.min(arquivo.size, TAMANHO_MAXIMO_BYTES),
  });
  if (!meta.valido) return meta.erro ?? MSG_ENVIO_FALHOU;
  const cabecalho = await arquivo.slice(0, 12).arrayBuffer();
  const magic = validarMagicBytes(new Uint8Array(cabecalho));
  if (!magic.valido) return magic.erro ?? MSG_ENVIO_FALHOU;
  return null;
}

/**
 * Corpo da página Galeria (specs/galeria-imagens-loja.md, páginas 1 e 2),
 * compartilhado pelo painel do lojista e pelo hub admin. Nenhum número que
 * vale sai daqui: o teto é contado na action, o uso que limpa produtos é o da
 * RPC de remoção e o resultado mostrado é o devolvido pelo servidor.
 */
export function GaleriaImagens({
  voltarHref,
  voltarRotulo,
  imagensIniciais,
  cursorInicial,
  totalInicial,
  usosIniciais,
  acoes,
}: GaleriaImagensProps): ReactElement {
  const router = useRouter();
  const entradaRef = useRef<HTMLInputElement>(null);

  const [imagens, setImagens] = useState<ImagemGaleria[]>(imagensIniciais);
  const [cursor, setCursor] = useState<CursorGaleria | null>(cursorInicial);
  const [total, setTotal] = useState(totalInicial);
  const [emUso, setEmUso] = useState<Set<string>>(() => idsEmUso(usosIniciais));

  // Toda action da galeria revalida a rota, e o servidor manda uma primeira
  // página nova. Quando ela chega, o estado volta a ser o do servidor (a
  // grade recarrega); até lá, valem as atualizações locais abaixo. Padrão
  // "guardar o valor anterior" do React, sem efeito.
  const [origem, setOrigem] = useState({ imagens: imagensIniciais, total: totalInicial });
  if (origem.imagens !== imagensIniciais || origem.total !== totalInicial) {
    setOrigem({ imagens: imagensIniciais, total: totalInicial });
    setImagens(imagensIniciais);
    setCursor(cursorInicial);
    setTotal(totalInicial);
    setEmUso(idsEmUso(usosIniciais));
  }

  const [selecionando, setSelecionando] = useState(false);
  const [selecionadas, setSelecionadas] = useState<Set<string>>(() => new Set());
  const [consultando, setConsultando] = useState(false);
  const [usosRemocao, setUsosRemocao] = useState<UsoImagem[] | null>(null);
  const [removendo, setRemovendo] = useState(false);
  const [fila, setFila] = useState<Fila | null>(null);

  const enviando = fila?.rodando ?? false;

  // ── Envio ────────────────────────────────────────────────────────────────

  function abrirSeletorDeArquivos(): void {
    if (enviando) return;
    // Prévia do teto (D6): a recusa que vale é a da action.
    if (atingiuTeto(total)) {
      toast.error(MSG_TETO);
      return;
    }
    entradaRef.current?.click();
  }

  function atualizarItem(i: number, item: ItemFila): void {
    setFila((f) => (f ? { ...f, itens: f.itens.map((x, j) => (j === i ? item : x)) } : f));
  }

  async function enviarUm(arquivo: File): Promise<ResultadoEnvioGaleria> {
    const invalido = await validarArquivo(arquivo);
    if (invalido) return { ok: false, erro: invalido };
    const par = await prepararImagemParaGaleria(arquivo);
    if (!par.ok) return { ok: false, erro: par.erro };
    const fd = new FormData();
    fd.append(CAMPO_ARQUIVO, par.original, "original.webp");
    fd.append(CAMPO_MINIATURA, par.miniatura, "miniatura.webp");
    return acoes.enviarImagem(fd);
  }

  /** P5: fila SEQUENCIAL, uma chamada por arquivo; erro de um não derruba os outros. */
  async function enviarArquivos(arquivos: File[]): Promise<void> {
    if (arquivos.length === 0) return;
    setFila({
      itens: arquivos.map((a) => ({ nome: a.name, estado: "aguardando" })),
      rodando: true,
    });

    let enviadas = 0;
    for (let i = 0; i < arquivos.length; i++) {
      const nome = arquivos[i].name;
      atualizarItem(i, { nome, estado: "enviando" });
      let r: ResultadoEnvioGaleria;
      try {
        r = await enviarUm(arquivos[i]);
      } catch (e) {
        console.error("[GaleriaImagens] envio", e);
        r = { ok: false, erro: MSG_ENVIO_FALHOU };
      }
      if (r.ok) {
        enviadas++;
        const nova = r.imagem;
        atualizarItem(i, { nome, estado: "enviada" });
        setImagens((lista) => incluirNoInicio(lista, nova));
        setTotal((t) => t + 1);
        continue;
      }
      atualizarItem(i, { nome, estado: "erro", erro: r.erro });
      if (interrompeFila(r.erro)) {
        const motivo = r.erro;
        setFila((f) =>
          f
            ? {
                ...f,
                itens: f.itens.map((x, j) =>
                  j > i ? { nome: x.nome, estado: "erro", erro: motivo } : x,
                ),
              }
            : f,
        );
        break;
      }
    }

    setFila((f) => (f ? { ...f, rodando: false } : f));
    const resumo = resumoEnvio(enviadas, arquivos.length);
    if (enviadas === arquivos.length) toast.success(resumo);
    else toast.error(resumo);
    router.refresh();
  }

  function aoEscolherArquivos(e: ChangeEvent<HTMLInputElement>): void {
    const arquivos = Array.from(e.target.files ?? []);
    // Limpa o input: escolher os mesmos arquivos de novo dispara outra vez.
    e.target.value = "";
    void enviarArquivos(arquivos);
  }

  // ── Carregar mais ────────────────────────────────────────────────────────

  async function aoCarregarPagina(pagina: PaginaGaleria): Promise<void> {
    setImagens((lista) => anexarPagina(lista, pagina.imagens));
    setCursor(pagina.proximo_cursor);
    if (pagina.imagens.length === 0) return;
    // Selo da página nova; sem ele a grade só perde o selo, nada mais.
    try {
      const r = await acoes.consultarUso(pagina.imagens.map((i) => i.id));
      if (r.ok) {
        const novos = idsEmUso(r.usos);
        setEmUso((atual) => new Set([...atual, ...novos]));
      }
    } catch (e) {
      console.error("[GaleriaImagens] uso da página", e);
    }
  }

  // ── Seleção e remoção ────────────────────────────────────────────────────

  function sairDaSelecao(): void {
    setSelecionando(false);
    setSelecionadas(new Set());
  }

  function aoAlternar(id: string): void {
    const r = alternarSelecao(selecionadas, id);
    if (r.recusada) toast.info(MSG_LIMITE_SELECAO);
    setSelecionadas(r.selecao);
  }

  async function pedirRemocao(): Promise<void> {
    if (selecionadas.size === 0 || consultando) return;
    setConsultando(true);
    try {
      const r = await acoes.consultarUso([...selecionadas]);
      if (!r.ok) {
        toast.error(r.erro);
        return;
      }
      if (r.usos.length === 0) {
        // Nada mais é original da loja: todas sumiram em outra aba.
        toast.info(
          mensagemResultadoRemocao({ removidas: 0, ignoradas: 0, produtosLimpos: 0, logoLimpa: false }),
        );
        setImagens((lista) => tirarIds(lista, selecionadas));
        sairDaSelecao();
        router.refresh();
        return;
      }
      setUsosRemocao(r.usos);
    } catch (e) {
      console.error("[GaleriaImagens] consultar uso", e);
      toast.error(MSG_USO_FALHOU);
    } finally {
      setConsultando(false);
    }
  }

  async function confirmarRemocao(): Promise<void> {
    if (removendo) return;
    const ids = [...selecionadas];
    setRemovendo(true);
    try {
      const r = await acoes.remover(ids);
      if (!r.ok) {
        toast.error(r.erro);
        return;
      }
      // Números do SERVIDOR, nunca os da seleção local.
      toast.success(mensagemResultadoRemocao(r));
      setImagens((lista) => tirarIds(lista, ids));
      setTotal((t) => Math.max(0, t - r.removidas));
      setUsosRemocao(null);
      sairDaSelecao();
      router.refresh();
    } catch (e) {
      console.error("[GaleriaImagens] remover", e);
      toast.error(MSG_REMOCAO_FALHOU);
    } finally {
      setRemovendo(false);
    }
  }

  const descricao = usosRemocao ? descreverRemocao(usosRemocao) : null;
  const vazia = imagens.length === 0;
  const atual = fila?.itens.findIndex((x) => x.estado === "enviando") ?? -1;
  const errosFila = fila?.itens.filter((x) => x.estado === "erro") ?? [];

  return (
    <div
      className={
        selecionando
          ? "mx-auto flex w-full max-w-5xl flex-col gap-4 pb-28 sm:pb-0"
          : "mx-auto flex w-full max-w-5xl flex-col gap-4"
      }
    >
      <CabecalhoPagina voltarHref={voltarHref} voltarRotulo={voltarRotulo} titulo="Galeria">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">{rotuloContador(total)}</span>
          {!vazia && !selecionando ? (
            <Button
              type="button"
              variant="outline"
              className={ALVO}
              disabled={enviando}
              onClick={() => setSelecionando(true)}
            >
              Selecionar
            </Button>
          ) : null}
          {!selecionando ? (
            <Button
              type="button"
              className={ALVO}
              disabled={enviando}
              onClick={abrirSeletorDeArquivos}
            >
              {enviando ? <Loader2 aria-hidden className="animate-spin" /> : <Upload aria-hidden />}
              Enviar imagens
            </Button>
          ) : null}
        </div>
      </CabecalhoPagina>

      <input
        ref={entradaRef}
        type="file"
        multiple
        accept={TIPOS_IMAGEM_PERMITIDOS.join(",")}
        className="hidden"
        aria-hidden
        tabIndex={-1}
        onChange={aoEscolherArquivos}
      />

      {fila ? (
        <Card>
          <CardContent className="flex flex-col gap-2">
            <p role="status" aria-live="polite" className="text-sm font-medium">
              {fila.rodando && atual >= 0
                ? rotuloProgressoEnvio(atual + 1, fila.itens.length)
                : resumoEnvio(
                    fila.itens.filter((x) => x.estado === "enviada").length,
                    fila.itens.length,
                  )}
            </p>
            {errosFila.length > 0 ? (
              <ul className="flex flex-col gap-1 text-sm text-destructive">
                {fila.itens.map((x, i) =>
                  x.estado === "erro" ? (
                    <li key={`${i}-${x.nome}`} className="break-words">
                      <span className="font-medium">{x.nome}:</span> {x.erro}
                    </li>
                  ) : null,
                )}
              </ul>
            ) : null}
            {!fila.rodando ? (
              <Button
                type="button"
                variant="ghost"
                className={`${ALVO} self-start`}
                onClick={() => setFila(null)}
              >
                Fechar
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {selecionando ? (
        // Padrão da `BarraSelecaoLote` (design §10.1): fixa no rodapé no
        // mobile, `sticky top-0` a partir de `sm`. A contagem é só a da
        // intenção; o número que vale vem do servidor no diálogo.
        <div className="fixed inset-x-0 bottom-0 z-40 min-h-[64px] border-t bg-background p-3 shadow-lg sm:sticky sm:top-0 sm:bottom-auto sm:z-30 sm:rounded-xl sm:border sm:shadow-sm">
          <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-2">
            <p aria-live="polite" className="text-sm font-medium">
              {rotuloSelecao(selecionadas.size)}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                className={ALVO}
                disabled={selecionadas.size === 0}
                onClick={() => setSelecionadas(new Set())}
              >
                Limpar
              </Button>
              <Button type="button" variant="ghost" className={ALVO} onClick={sairDaSelecao}>
                Cancelar
              </Button>
              <Button
                type="button"
                variant="destructive"
                className={ALVO}
                disabled={selecionadas.size === 0 || consultando}
                onClick={pedirRemocao}
              >
                {consultando ? <Loader2 aria-hidden className="animate-spin" /> : null}
                Remover
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <Card>
        <CardContent>
          {vazia ? (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <p className="font-medium">Sua galeria está vazia.</p>
              <p className="max-w-sm text-sm text-muted-foreground">
                Envie as fotos dos seus produtos e a logo da loja para reaproveitar quando
                quiser.
              </p>
              <Button
                type="button"
                className={ALVO}
                disabled={enviando}
                onClick={abrirSeletorDeArquivos}
              >
                <Upload aria-hidden />
                Enviar imagens
              </Button>
            </div>
          ) : (
            <GradeImagens
              imagens={imagens}
              emUso={emUso}
              selecao={
                selecionando
                  ? { modo: "multipla", selecionadas, onAlternar: aoAlternar }
                  : { modo: "nenhuma" }
              }
              proximoCursor={cursor}
              listarMais={acoes.listarMais}
              onPaginaCarregada={aoCarregarPagina}
            />
          )}
        </CardContent>
      </Card>

      <AlertDialog
        open={descricao !== null}
        onOpenChange={(aberto) => {
          if (!aberto && !removendo) setUsosRemocao(null);
        }}
      >
        <AlertDialogContent>
          {descricao ? (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>{descricao.titulo}</AlertDialogTitle>
                <AlertDialogDescription render={<div />} className="flex flex-col gap-2">
                  {descricao.paragrafos.map((p) => (
                    <p key={p}>{p}</p>
                  ))}
                  {descricao.produtos.length > 0 ? (
                    <p>
                      Produtos: {descricao.produtos.join(", ")}
                      {descricao.produtosAlemDaLista > 0
                        ? ` e mais ${descricao.produtosAlemDaLista}`
                        : ""}
                      .
                    </p>
                  ) : null}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className={ALVO} disabled={removendo}>
                  Cancelar
                </AlertDialogCancel>
                <Button
                  type="button"
                  variant="destructive"
                  className={ALVO}
                  disabled={removendo}
                  onClick={confirmarRemocao}
                >
                  {removendo ? <Loader2 aria-hidden className="animate-spin" /> : null}
                  Remover
                </Button>
              </AlertDialogFooter>
            </>
          ) : null}
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

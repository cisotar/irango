"use client";

import { useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Info, Loader2, Plus, Trash2 } from "lucide-react";
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
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { paraNumero } from "@/components/painel/payloadZona";
import type { salvarFaixasEntrega as salvarFaixasLojista } from "@/lib/actions/entrega";
import type { ZonaVitrine } from "@/lib/supabase/queries/entregaPagamento";
import {
  alertaDePreco,
  lerFaixas,
  limiteEntregaKm,
  rotuloFaixa,
  textoLimiteEntrega,
  zonasJaSaoFaixas,
  type IncrementoFaixa,
} from "@/lib/utils/faixasEntrega";
import {
  TETO_FAIXAS_ENTREGA,
  schemaFaixasEntrega,
  type DadosFaixasEntrega,
} from "@/lib/validacoes/entrega";

export type TabelaFaixasEntregaProps = {
  /** Zonas GRAVADAS da loja: abrem como faixas via `lerFaixas` (D4/C4). */
  zonas: ZonaVitrine[];
  /** `lojas.taxa_entrega_fora_zona` — só para a copy do limite (D7). */
  taxaForaZona: number | null;
  /**
   * Action injetada (issue 160): a do lojista ou a admin escopada por `lojaId`.
   * Sem default — omitir quebra o build em vez de gravar na loja errada.
   */
  salvar: typeof salvarFaixasLojista;
};

/** Faixa como a tela a edita: strings de input; `gratis === null` = sem frete grátis. */
type FaixaEditavel = { taxa: string; gratis: string | null };

/** Alvo de toque literal (design-system §5): a base de fonte é 120%. */
const ALVO = "min-h-[44px] min-w-[44px]";

const ROTULO_TIPO: Record<string, string> = {
  bairro: "Por bairro",
  raio_km: "Por raio (km)",
  faixa_cep: "Por faixa de CEP",
};

/** Número do banco → texto do input no formato BR ("4,50"); `paraNumero` desfaz. */
function paraTexto(valor: number): string {
  return valor.toFixed(2).replace(".", ",");
}

/** Zonas gravadas hoje (aviso de legado D4 e confirmação de substituição). */
function ListaZonasAtuais({
  zonas,
  rotulo,
  className = "",
}: {
  zonas: ZonaVitrine[];
  rotulo: string;
  className?: string;
}) {
  return (
    <ul
      aria-label={rotulo}
      className={`divide-y divide-foreground/10 rounded-lg border ${className}`}
    >
      {zonas.map((z) => (
        <li key={z.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
          <span className="font-medium text-foreground">{z.nome}</span>
          <span className="text-xs text-muted-foreground">
            {ROTULO_TIPO[z.tipo] ?? z.tipo}
            {z.ativo ? "" : " · desativada"}
          </span>
        </li>
      ))}
    </ul>
  );
}

type Montagem =
  | { ok: true; payload: DadosFaixasEntrega }
  | { ok: false; erro: string };

/**
 * Dependências do envio (architecture.md §8): a Server Action, o router e o
 * toast INJETADOS por parâmetro — nunca lidos do módulo direto — para a
 * orquestração "salvar → toast → router.refresh" ser testável em
 * `environment: node`, sem jsdom, sem renderizar nem disparar clique.
 */
export type DepsEnvioFaixas = {
  salvar: typeof salvarFaixasLojista;
  router: { refresh: () => void };
  toast: { success: (msg: string) => void; error: (msg: string) => void };
};

/**
 * Chama a action e, só no sucesso, avisa e revalida a tela (`router.refresh`).
 * No erro, nunca chama `router.refresh` — a tela erra e o lojista tenta de
 * novo sem re-buscar o servidor.
 */
export async function enviarFaixas(
  payload: DadosFaixasEntrega,
  { salvar, router, toast }: DepsEnvioFaixas,
): Promise<{ ok: true } | { ok: false }> {
  const resultado = await salvar(payload);
  if (!resultado.ok) {
    toast.error(resultado.erro);
    return { ok: false };
  }
  toast.success("Faixas de entrega salvas!");
  router.refresh();
  return { ok: true };
}

/**
 * Estado da tela → payload de `salvarFaixasEntrega`. `schemaFaixasEntrega` aqui
 * é só gate de UX: a Server Action revalida e a RPC rederiva teto/nome/tipo.
 */
export function montarPayload(incremento: IncrementoFaixa, faixas: FaixaEditavel[]): Montagem {
  const itens: Array<{ taxa: number; pedido_minimo_gratis: number | null }> = [];
  for (const [i, f] of faixas.entries()) {
    const rotulo = rotuloFaixa(i, incremento);
    const taxa = paraNumero(f.taxa);
    if (taxa == null) return { ok: false, erro: `Informe o preço da faixa de ${rotulo}.` };
    let gratis: number | null = null;
    if (f.gratis !== null) {
      gratis = paraNumero(f.gratis);
      if (gratis == null) {
        return {
          ok: false,
          erro: `Informe o valor do frete grátis da faixa de ${rotulo} ou desligue a opção.`,
        };
      }
    }
    itens.push({ taxa, pedido_minimo_gratis: gratis });
  }

  const parsed = schemaFaixasEntrega.safeParse({ incremento, faixas: itens });
  if (parsed.success) return { ok: true, payload: parsed.data };

  const [, indice, campo] = parsed.error.issues[0]?.path ?? [];
  if (typeof indice === "number") {
    const oQue = campo === "pedido_minimo_gratis" ? "o frete grátis" : "o preço";
    return {
      ok: false,
      erro: `Confira ${oQue} da faixa de ${rotuloFaixa(indice, incremento)}: use valor positivo com até 2 casas decimais.`,
    };
  }
  return { ok: false, erro: "Confira as faixas de entrega." };
}

/**
 * Tabela de faixas de entrega por km (issue 326). Client component.
 *
 * Abre as zonas gravadas com `lerFaixas` (nada é gravado ao abrir); só o
 * "Salvar faixas" grava, em lote, pela action injetada. O preço mostrado aqui é
 * cosmético: o frete do pedido é sempre recalculado no servidor.
 *
 * Sem "ativa" por faixa (C2): o lojista não pula faixa — reduz a área tirando a
 * última (C3). O aviso de preço fora de ordem (C1) não bloqueia o Salvar.
 */
export function TabelaFaixasEntrega({ zonas, taxaForaZona, salvar }: TabelaFaixasEntregaProps) {
  const router = useRouter();
  const idBase = useId();

  const leitura = useMemo(() => lerFaixas(zonas), [zonas]);
  const substituiZonas = useMemo(() => !zonasJaSaoFaixas(zonas), [zonas]);

  const [emLegado, setEmLegado] = useState(leitura.modo === "legado");
  const [incremento, setIncremento] = useState<IncrementoFaixa>(leitura.incremento);
  const [faixas, setFaixas] = useState<FaixaEditavel[]>(() =>
    leitura.faixas.map((f) => ({
      taxa: paraTexto(f.taxa),
      gratis: f.pedido_minimo_gratis == null ? null : paraTexto(f.pedido_minimo_gratis),
    })),
  );

  const [incrementoPendente, setIncrementoPendente] = useState<IncrementoFaixa | null>(null);
  const [payloadPendente, setPayloadPendente] = useState<DadosFaixasEntrega | null>(null);
  const [enviando, startEnvio] = useTransition();

  // Foco vai para o campo que o lojista precisa preencher em seguida, depois
  // que a linha/campo novo existe no DOM.
  const focarRef = useRef<string | null>(null);
  useEffect(() => {
    if (focarRef.current == null) return;
    document.getElementById(focarRef.current)?.focus();
    focarRef.current = null;
  });

  const idPreco = (i: number) => `${idBase}-preco-${i}`;
  const idGratis = (i: number) => `${idBase}-gratis-${i}`;
  const idAlerta = (i: number) => `${idBase}-alerta-${i}`;

  // Linha sem preço digitado conta como 0: nunca vira "a mais cara" nem
  // dispara o aviso (o aviso só aparece na linha que já tem preço).
  const precos = faixas.map((f) => ({ taxa: paraNumero(f.taxa) ?? 0 }));
  const limite = limiteEntregaKm(faixas.length, incremento);

  function trocarIncremento(valor: unknown) {
    const novo: IncrementoFaixa = valor === "2" ? 2 : 1;
    if (novo === incremento) return;
    if (faixas.length > 0) {
      setIncrementoPendente(novo);
      return;
    }
    setIncremento(novo);
  }

  function confirmarTrocaIncremento() {
    if (incrementoPendente == null) return;
    // D5: sem remapear preço — a tabela local recomeça vazia.
    setIncremento(incrementoPendente);
    setFaixas([]);
    setIncrementoPendente(null);
  }

  function atualizar(i: number, parcial: Partial<FaixaEditavel>) {
    setFaixas((atual) => atual.map((f, j) => (j === i ? { ...f, ...parcial } : f)));
  }

  function alternarGratis(i: number, ligado: boolean) {
    atualizar(i, { gratis: ligado ? "" : null });
    if (ligado) focarRef.current = idGratis(i);
  }

  function adicionar() {
    if (faixas.length >= TETO_FAIXAS_ENTREGA) return;
    setFaixas((atual) => [...atual, { taxa: "", gratis: null }]);
    focarRef.current = idPreco(faixas.length);
  }

  function removerUltima() {
    setFaixas((atual) => atual.slice(0, -1));
  }

  function comecarDoZero() {
    setEmLegado(false);
    setIncremento(1);
    setFaixas([]);
  }

  function aoSalvar() {
    const montagem = montarPayload(incremento, faixas);
    if (!montagem.ok) {
      toast.error(montagem.erro);
      return;
    }
    if (substituiZonas) {
      setPayloadPendente(montagem.payload);
      return;
    }
    enviar(montagem.payload);
  }

  function enviar(payload: DadosFaixasEntrega) {
    startEnvio(async () => {
      const resultado = await enviarFaixas(payload, { salvar, router, toast });
      if (resultado.ok) setPayloadPendente(null);
    });
  }

  return (
    <>
      <div
        role="note"
        className="mb-5 flex items-start gap-3 rounded-lg border bg-muted/50 p-4 text-sm"
      >
        <Info className="mt-0.5 size-5 shrink-0 text-foreground" aria-hidden />
        <div className="space-y-1">
          <p className="font-medium text-foreground">
            Cobre sua área por distância, não por CEP ou bairro
          </p>
          <p className="text-muted-foreground">
            Com faixas de km você define{" "}
            <strong className="font-medium text-foreground">
              só até onde entrega e o preço de cada faixa
            </strong>{" "}
            — o sistema calcula a distância de cada pedido sozinho. Por CEP ou por bairro, cada
            CEP e cada bairro precisa ser cadastrado um por um, e o que ficar de fora vira pedido
            perdido.
          </p>
        </div>
      </div>

      {emLegado ? (
        <Card className="gap-0 py-0">
          <div className="space-y-3 p-4">
            <p className="flex gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                Suas zonas de entrega foram cadastradas de um jeito que não vira tabela de faixas.
                Elas continuam valendo na vitrine até você salvar uma tabela nova.
              </span>
            </p>
            <ListaZonasAtuais zonas={zonas} rotulo="Zonas de entrega atuais" />
            <Button type="button" variant="outline" className={`${ALVO} w-full md:w-auto`} onClick={comecarDoZero}>
              Começar a tabela do zero
            </Button>
          </div>
        </Card>
      ) : (
        <Card className="gap-0 py-0">
          <div className="border-b px-4 py-3">
            <h2 className="font-heading text-base font-medium text-foreground">
              Faixas de distância
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Comece pela faixa mais perto da loja e vá somando até onde você entrega.
            </p>
          </div>

          <fieldset className="border-b px-4 py-3">
            <legend className="mb-2 text-sm font-medium text-foreground">
              Tamanho de cada faixa
            </legend>
            <RadioGroup
              value={String(incremento)}
              onValueChange={trocarIncremento}
              className="flex gap-2"
              disabled={enviando}
            >
              {([1, 2] as const).map((valor) => (
                <Label
                  key={valor}
                  htmlFor={`${idBase}-inc-${valor}`}
                  className={`${ALVO} cursor-pointer gap-3 rounded-lg border px-3`}
                >
                  <RadioGroupItem value={String(valor)} id={`${idBase}-inc-${valor}`} />
                  <span>{valor} em {valor}&nbsp;km</span>
                </Label>
              ))}
            </RadioGroup>
            <p className="mt-2 text-xs text-muted-foreground">
              Faixas menores = preço mais justo. Faixas maiores = menos linhas para manter.
            </p>
          </fieldset>

          {leitura.modo === "faixas" && leitura.zonasNoAviso.length > 0 && (
            <p className="flex gap-2 border-b bg-amber-50 px-4 py-2 text-sm text-amber-900">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                Zonas desativadas que saem da loja ao salvar:{" "}
                {leitura.zonasNoAviso.map((z) => z.nome).join(", ")}.
              </span>
            </p>
          )}

          {faixas.length > 0 && (
            <div
              aria-hidden
              className="hidden border-b bg-muted px-4 py-2 text-xs font-medium tracking-wide text-muted-foreground uppercase md:grid md:grid-cols-[5.5rem_7.5rem_1fr_44px] md:items-center md:gap-3"
            >
              <span>Faixa</span>
              <span>Preço</span>
              <span>Frete grátis a partir de</span>
              <span />
            </div>
          )}

          {faixas.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <p className="text-sm text-muted-foreground">Nenhuma faixa cadastrada ainda.</p>
              {/* D7: o que a vitrine faz sem faixa vem do estado real, no rodapé
                  (`textoLimiteEntrega`), para não repetir nem divergir aqui. */}
              <p className="mx-auto mt-1 max-w-xs text-xs text-muted-foreground">
                Adicione a primeira faixa para começar a cobrar por distância.
              </p>
            </div>
          ) : (
            <ul>
              {faixas.map((f, i) => {
                const rotulo = rotuloFaixa(i, incremento);
                const alerta = f.taxa.trim() === "" ? null : alertaDePreco(precos, i, incremento);
                const ultima = i === faixas.length - 1;
                return (
                  <li
                    key={i}
                    className="grid grid-cols-[1fr_44px] gap-x-3 gap-y-2 border-b px-4 py-3 md:grid-cols-[5.5rem_7.5rem_1fr_44px] md:items-center"
                  >
                    <span className="col-start-1 row-start-1 self-center text-sm font-medium text-foreground">
                      {rotulo}
                    </span>

                    <div className="col-start-2 row-start-1 flex justify-center md:col-start-4">
                      {ultima && (
                        <Button
                          type="button"
                          variant="ghost"
                          className={ALVO}
                          aria-label={`Remover faixa de ${rotulo}`}
                          onClick={removerUltima}
                          disabled={enviando}
                        >
                          <Trash2 className="size-4 text-destructive" aria-hidden />
                        </Button>
                      )}
                    </div>

                    <div className="col-span-2 md:col-span-1 md:col-start-2 md:row-start-1">
                      <Label htmlFor={idPreco(i)} className="mb-1 text-xs md:sr-only">
                        Preço do frete
                      </Label>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-muted-foreground">R$</span>
                        <Input
                          id={idPreco(i)}
                          inputMode="decimal"
                          className="min-h-[44px]"
                          value={f.taxa}
                          onChange={(e) => atualizar(i, { taxa: e.target.value })}
                          placeholder="0,00"
                          aria-label={`Preço do frete da faixa de ${rotulo}`}
                          aria-describedby={alerta ? idAlerta(i) : undefined}
                          disabled={enviando}
                        />
                      </div>
                    </div>

                    <div className="col-span-2 flex flex-wrap items-center gap-2 md:col-span-1 md:col-start-3 md:row-start-1">
                      <Label className={`${ALVO} cursor-pointer`}>
                        <Switch
                          checked={f.gratis !== null}
                          disabled={enviando}
                          onCheckedChange={(v) => alternarGratis(i, v === true)}
                          aria-label={`Frete grátis na faixa de ${rotulo}`}
                        />
                      </Label>
                      {f.gratis === null ? (
                        <span className="text-xs text-muted-foreground">Sem frete grátis</span>
                      ) : (
                        <>
                          <Label htmlFor={idGratis(i)} className="text-xs md:sr-only">
                            Frete grátis a partir de
                          </Label>
                          <span className="text-xs text-muted-foreground">R$</span>
                          <Input
                            id={idGratis(i)}
                            inputMode="decimal"
                            className="min-h-[44px] max-w-[7rem]"
                            value={f.gratis}
                            onChange={(e) => atualizar(i, { gratis: e.target.value })}
                            placeholder="0,00"
                            aria-label={`Frete grátis a partir de, na faixa de ${rotulo}`}
                            disabled={enviando}
                          />
                        </>
                      )}
                    </div>

                    {alerta && (
                      <p
                        id={idAlerta(i)}
                        role="status"
                        className="col-span-2 flex gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 md:col-span-4"
                      >
                        <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                        <span>{alerta}</span>
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          <div className="border-t px-4 py-3">
            <Button
              type="button"
              variant="outline"
              className={`${ALVO} w-full md:w-auto`}
              onClick={adicionar}
              disabled={enviando || faixas.length >= TETO_FAIXAS_ENTREGA}
            >
              <Plus className="size-4" aria-hidden />
              {faixas.length >= TETO_FAIXAS_ENTREGA
                ? `Limite de ${TETO_FAIXAS_ENTREGA} faixas`
                : `Adicionar faixa ${rotuloFaixa(faixas.length, incremento)}`}
            </Button>
          </div>

          <div className="flex flex-col gap-3 border-t bg-muted px-4 py-3 md:flex-row md:items-center md:justify-between">
            <p aria-live="polite" className="text-sm text-muted-foreground">
              {textoLimiteEntrega(limite, taxaForaZona)}
            </p>
            <Button
              type="button"
              className={`${ALVO} w-full md:w-auto`}
              onClick={aoSalvar}
              disabled={enviando}
            >
              {enviando && <Loader2 className="size-4 animate-spin" aria-hidden />}
              Salvar faixas
            </Button>
          </div>
        </Card>
      )}

      <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
        <strong className="font-medium text-foreground">Configure com margem.</strong> O CEP do
        cliente costuma cair no centro do bairro ou da cidade, não no endereço exato. Para atender
        5&nbsp;km reais, cadastre faixas até 7–8&nbsp;km. O valor cobrado no pedido é sempre o
        recalculado pelo servidor.
      </p>

      <AlertDialog
        open={incrementoPendente !== null}
        onOpenChange={(aberto) => {
          if (!aberto) setIncrementoPendente(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Trocar o tamanho das faixas?</AlertDialogTitle>
            <AlertDialogDescription>
              Isso apaga as faixas desta tela; nada muda na vitrine até salvar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className={ALVO}>Cancelar</AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              className={ALVO}
              onClick={confirmarTrocaIncremento}
            >
              Apagar e trocar
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={payloadPendente !== null}
        onOpenChange={(aberto) => {
          if (!aberto && !enviando) setPayloadPendente(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Substituir as zonas atuais?</AlertDialogTitle>
            <AlertDialogDescription>
              As zonas de entrega cadastradas hoje saem da loja e a vitrine passa a cobrar por
              estas faixas. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {zonas.length > 0 && (
            <ListaZonasAtuais
              zonas={zonas}
              rotulo="Zonas que serão substituídas"
              className="max-h-48 overflow-y-auto text-sm"
            />
          )}
          <AlertDialogFooter>
            <AlertDialogCancel className={ALVO} disabled={enviando}>
              Cancelar
            </AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              className={ALVO}
              disabled={enviando}
              onClick={() => {
                if (payloadPendente) enviar(payloadPendente);
              }}
            >
              {enviando && <Loader2 className="size-4 animate-spin" aria-hidden />}
              Substituir e salvar
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

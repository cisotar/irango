"use client";

// Lista de endereços (≤3): seção "Endereços" de /minha-conta e página dedicada
// /minha-conta/enderecos. Edição e inclusão no próprio card com salvamento
// automático (D10); remover com AlertDialog; "Remover" desabilitado no último
// (D9). Toda regra (teto, mínimo, padrão, posse) é do servidor/banco — aqui é
// só preview. Textos do usuário vão por JSX (escape), nunca HTML cru.
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus } from "lucide-react";

import {
  definirEnderecoPadrao,
  removerEnderecoCliente,
  salvarEnderecoCliente,
} from "@/lib/actions/cliente";
import {
  MAX_ENDERECOS,
  schemaEnderecoCliente,
  type EntradaEnderecoCliente,
} from "@/lib/validacoes/cliente";
import type { EnderecoCliente } from "@/lib/supabase/queries/clientes";
import type { EnderecoEntrega } from "@/components/vitrine/FormEndereco";
import { BlocoEndereco } from "@/components/cliente/BlocoEndereco";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const NOVO = "novo";
const ATRASO_AUTOSAVE_MS = 800;

type Status = "ocioso" | "salvando" | "salvo";

function paraEntrega(e: EnderecoCliente): EnderecoEntrega {
  return {
    cep: e.cep,
    rua: e.rua,
    numero: e.numero,
    complemento: e.complemento ?? undefined,
    bairro: e.bairro,
    cidade: e.cidade,
    uf: e.uf,
  };
}

/** Assinatura estável para comparar "mudou desde o último salvo". */
const chave = (e: EntradaEnderecoCliente) => JSON.stringify(schemaEnderecoCliente.parse(e));

/**
 * Salvamento automático: quando o bloco emite um endereço válido e diferente
 * do último salvo, espera uma pausa na digitação e chama `salvar`.
 */
function useAutosave(inicial: string | null, salvar: (e: EntradaEnderecoCliente) => Promise<boolean>) {
  const [status, setStatus] = useState<Status>("ocioso");
  const ultimo = useRef<string | null>(inicial);
  const ocupado = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  // Salva o valor pendente mais recente; se uma edição chega com salvamento em
  // andamento, fica guardada e é salva quando ele terminar ("Salvo" só depois
  // do último valor persistido).
  const pendente = useRef<{ e: EntradaEnderecoCliente; k: string } | null>(null);

  const drenar = useCallback(async () => {
    if (ocupado.current) return;
    ocupado.current = true;
    let ok = true;
    while (pendente.current) {
      const { e, k } = pendente.current;
      pendente.current = null;
      if (k === ultimo.current) continue;
      setStatus("salvando");
      ok = await salvar(e);
      if (ok) ultimo.current = k;
    }
    ocupado.current = false;
    setStatus(ok ? "salvo" : "ocioso");
  }, [salvar]);

  const aoMudar = useCallback(
    (e: EntradaEnderecoCliente | null) => {
      if (timer.current) clearTimeout(timer.current);
      if (!e || !schemaEnderecoCliente.safeParse(e).success) return;
      const k = chave(e);
      if (k === ultimo.current && !ocupado.current) return;
      timer.current = setTimeout(() => {
        pendente.current = { e, k };
        void drenar();
      }, ATRASO_AUTOSAVE_MS);
    },
    [drenar],
  );

  return { status, aoMudar };
}

function StatusAutosave({ status }: { status: Status }) {
  return (
    <p role="status" className="min-h-5 text-sm text-texto-muted">
      {status === "salvando" && (
        <span className="inline-flex items-center gap-1.5">
          <Loader2 className="size-3 animate-spin" aria-hidden="true" />
          Salvando…
        </span>
      )}
      {status === "salvo" && "Salvo"}
    </p>
  );
}

export function ListaEnderecos({
  enderecos,
  titulo,
}: {
  enderecos: EnderecoCliente[];
  /** h1 na página dedicada; h2 como seção da página única. */
  titulo: { nivel: "h1" | "h2"; texto: string; id?: string };
}) {
  const Titulo = titulo.nivel;
  // Só um bloco de edição por vez (FormEndereco usa ids fixos).
  const [editando, setEditando] = useState<string | null>(null); // id do endereço ou NOVO
  const [removendo, setRemovendo] = useState<EnderecoCliente | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const fecharNovo = useCallback(() => setEditando(null), []);
  const total = enderecos.length;
  const ultimo = total <= 1;

  async function tornarPadrao(id: string) {
    setOcupado(true);
    const r = await definirEnderecoPadrao({ id });
    setOcupado(false);
    if (!r.ok) toast.error(r.erro);
  }

  async function confirmarRemocao() {
    if (!removendo) return;
    setOcupado(true);
    const r = await removerEnderecoCliente({ id: removendo.id });
    setOcupado(false);
    if (!r.ok) toast.error(r.erro);
    if (editando === removendo.id) setEditando(null);
    setRemovendo(null);
  }

  return (
    <>
      <div className="flex items-baseline justify-between gap-2">
        <Titulo
          id={titulo.id}
          className={titulo.nivel === "h1" ? "text-xl font-semibold text-texto" : "text-lg font-semibold text-texto"}
        >
          {titulo.texto}
        </Titulo>
        <span className="text-sm text-texto-muted">
          {total} de {MAX_ENDERECOS}
        </span>
      </div>

      {/* Colunas pela largura do container (não da janela): abrir/fechar a
          lateral no PC recalcula. */}
      <ul className="grid grid-cols-[repeat(auto-fit,minmax(min(18rem,100%),1fr))] gap-3">
        {enderecos.map((e) => (
          <li key={e.id}>
            <Card className="h-full">
              <CardContent className="flex flex-1 flex-col gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium break-words text-texto">{e.rotulo}</p>
                  {e.padrao && <Badge>Padrão</Badge>}
                </div>
                <div className="text-sm break-words text-texto-muted">
                  <p>
                    {e.rua}, {e.numero}
                    {e.complemento ? `, ${e.complemento}` : ""} — {e.bairro}
                  </p>
                  <p>{e.cidade}</p>
                </div>

                {editando === e.id && <EdicaoEndereco endereco={e} />}

                <div className="mt-auto flex flex-wrap gap-2">
                  {!e.padrao && (
                    <Button
                      type="button"
                      variant="outline"
                      className="min-h-11"
                      disabled={ocupado}
                      aria-label={`Tornar padrão o endereço ${e.rotulo}`}
                      onClick={() => tornarPadrao(e.id)}
                    >
                      Tornar padrão
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11"
                    aria-expanded={editando === e.id}
                    aria-label={`Editar endereço ${e.rotulo}`}
                    onClick={() => setEditando((atual) => (atual === e.id ? null : e.id))}
                  >
                    Editar
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11"
                    disabled={ultimo || ocupado}
                    aria-label={`Remover endereço ${e.rotulo}`}
                    aria-describedby={ultimo ? "enderecos-minimo" : undefined}
                    onClick={() => setRemovendo(e)}
                  >
                    Remover
                  </Button>
                </div>
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>

      {ultimo && (
        <p id="enderecos-minimo" className="text-sm text-texto-muted">
          Mantenha pelo menos um endereço.
        </p>
      )}

      {editando === NOVO && total < MAX_ENDERECOS && (
        <Card>
          <CardContent>
            <NovoEndereco aoCriar={fecharNovo} />
          </CardContent>
        </Card>
      )}

      {total >= MAX_ENDERECOS ? (
        <p className="text-sm text-texto-muted">Você pode ter até {MAX_ENDERECOS} endereços.</p>
      ) : (
        editando !== NOVO && (
          <Button
            type="button"
            variant="outline"
            className="min-h-11 w-full self-start @min-[34rem]:w-auto"
            onClick={() => setEditando(NOVO)}
          >
            <Plus aria-hidden="true" />
            Adicionar endereço
          </Button>
        )
      )}

      <AlertDialog
        open={removendo !== null}
        onOpenChange={(abrir) => {
          if (!abrir && !ocupado) setRemovendo(null);
        }}
      >
        <AlertDialogContent>
          {removendo && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>Remover “{removendo.rotulo}”?</AlertDialogTitle>
                <AlertDialogDescription>
                  {removendo.rua}, {removendo.numero} — {removendo.bairro}.
                  {removendo.padrao && " O endereço mais antigo passa a ser o padrão."}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="min-h-11" disabled={ocupado}>
                  Cancelar
                </AlertDialogCancel>
                <Button
                  type="button"
                  variant="destructive"
                  className="min-h-11"
                  disabled={ocupado}
                  onClick={confirmarRemocao}
                >
                  {ocupado && <Loader2 className="animate-spin" aria-hidden="true" />}
                  Remover
                </Button>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function EdicaoEndereco({ endereco }: { endereco: EnderecoCliente }) {
  const inicial = {
    ...paraEntrega(endereco),
    rotulo: endereco.rotulo,
  };
  const salvar = useCallback(
    async (e: EntradaEnderecoCliente) => {
      const r = await salvarEnderecoCliente({ ...e, id: endereco.id });
      if (!r.ok) toast.error(r.erro);
      return r.ok;
    },
    [endereco.id],
  );
  const { status, aoMudar } = useAutosave(
    schemaEnderecoCliente.safeParse(inicial).success ? chave(inicial) : null,
    salvar,
  );

  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3">
      <BlocoEndereco
        rotuloInicial={endereco.rotulo}
        enderecoInicial={paraEntrega(endereco)}
        onChange={aoMudar}
      />
      <StatusAutosave status={status} />
    </div>
  );
}

function NovoEndereco({ aoCriar }: { aoCriar: () => void }) {
  // Já criado: o bloco está fechando; edição pendente não cria um 2º endereço.
  const criado = useRef(false);
  const salvar = useCallback(
    async (e: EntradaEnderecoCliente) => {
      if (criado.current) return true;
      const r = await salvarEnderecoCliente(e);
      if (!r.ok) {
        toast.error(r.erro);
        return false;
      }
      criado.current = true;
      aoCriar();
      return true;
    },
    [aoCriar],
  );
  const { status, aoMudar } = useAutosave(null, salvar);

  return (
    <div className="flex flex-col gap-2">
      <BlocoEndereco onChange={aoMudar} />
      <StatusAutosave status={status} />
    </div>
  );
}

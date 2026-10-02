"use client";

// Lista de endereços (≤3). Edição e inclusão no próprio card com salvamento
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
import { schemaEnderecoCliente, type EntradaEnderecoCliente } from "@/lib/validacoes/cliente";
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

const MAX_ENDERECOS = 3;
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

  const aoMudar = useCallback(
    (e: EntradaEnderecoCliente | null) => {
      if (timer.current) clearTimeout(timer.current);
      if (!e || !schemaEnderecoCliente.safeParse(e).success) return;
      const k = chave(e);
      if (k === ultimo.current) return;
      timer.current = setTimeout(async () => {
        if (ocupado.current) return;
        ocupado.current = true;
        setStatus("salvando");
        const ok = await salvar(e);
        ocupado.current = false;
        if (ok) ultimo.current = k;
        setStatus(ok ? "salvo" : "ocioso");
      }, ATRASO_AUTOSAVE_MS);
    },
    [salvar],
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

export function ListaEnderecos({ enderecos }: { enderecos: EnderecoCliente[] }) {
  // Só um bloco de edição por vez (FormEndereco usa ids fixos).
  const [editando, setEditando] = useState<string | "novo" | null>(null);
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
        <h1 className="text-xl font-semibold text-texto">Meus endereços</h1>
        <span className="text-sm text-texto-muted">
          {total} de {MAX_ENDERECOS}
        </span>
      </div>

      <ul className="flex flex-col gap-3">
        {enderecos.map((e) => (
          <li key={e.id}>
            <Card>
              <CardContent className="flex flex-col gap-3">
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

                <div className="flex flex-wrap gap-2">
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

      {editando === "novo" && total < MAX_ENDERECOS && (
        <Card>
          <CardContent>
            <NovoEndereco aoCriar={fecharNovo} />
          </CardContent>
        </Card>
      )}

      {total >= MAX_ENDERECOS ? (
        <p className="text-sm text-texto-muted">Você pode ter até 3 endereços.</p>
      ) : (
        editando !== "novo" && (
          <Button
            type="button"
            variant="outline"
            className="min-h-11 w-full"
            onClick={() => setEditando("novo")}
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
  const salvar = useCallback(
    async (e: EntradaEnderecoCliente) => {
      const r = await salvarEnderecoCliente(e);
      if (!r.ok) {
        toast.error(r.erro);
        return false;
      }
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

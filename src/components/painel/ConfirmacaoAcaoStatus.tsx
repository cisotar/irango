"use client";

import { useCallback, useState, type RefObject } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  copyConfirmacaoAcao,
  type AcaoDisponivel,
} from "@/lib/utils/acoesStatusPedido";

/**
 * Confirmação das ações de status que `exigeConfirmacao` (RN-SC6: atalho que
 * pula etapa e "Cancelar"). Compartilhada pelo menu do selo (`MenuStatusPedido`)
 * e pelos botões do detalhe (`AcoesStatus`). É UX, não segurança: a autoridade é
 * a Server Action.
 *
 * `pedir(acao)` devolve uma Promise resolvida com a escolha — é a dependência
 * `confirmar` de `executarAcaoStatus`, que só chama a action depois do "sim".
 */
type Pendente = { acao: AcaoDisponivel; resolver: (confirmou: boolean) => void };

export function useConfirmacaoAcao() {
  const [pendente, setPendente] = useState<Pendente | null>(null);
  const [aberto, setAberto] = useState(false);

  const pedir = useCallback(
    (acao: AcaoDisponivel) =>
      new Promise<boolean>((resolver) => {
        setPendente({ acao, resolver });
        setAberto(true);
      }),
    [],
  );

  // Mantém `pendente` depois de fechar: o texto não some durante a animação.
  function responder(confirmou: boolean) {
    pendente?.resolver(confirmou);
    setAberto(false);
  }

  return { pedir, aberto, acao: pendente?.acao ?? null, responder };
}

export function DialogoConfirmacaoAcao({
  aberto,
  acao,
  responder,
  numero,
  tipoEntrega,
  focoFinal,
}: {
  aberto: boolean;
  acao: AcaoDisponivel | null;
  responder: (confirmou: boolean) => void;
  /** Número curto do pedido, sem `#`. */
  numero: string;
  tipoEntrega: string | null;
  /** Para onde o foco volta ao fechar (o gatilho do menu). */
  focoFinal?: RefObject<HTMLElement | null>;
}) {
  const copy = acao ? copyConfirmacaoAcao(acao, numero, tipoEntrega) : null;

  return (
    <AlertDialog
      open={aberto}
      onOpenChange={(abrir) => {
        // Esc, clique fora e "Voltar" fecham sem confirmar.
        if (!abrir) responder(false);
      }}
    >
      <AlertDialogContent finalFocus={focoFinal}>
        {acao && copy && (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>{copy.titulo}</AlertDialogTitle>
              <AlertDialogDescription>{copy.corpo}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{copy.voltar}</AlertDialogCancel>
              <AlertDialogAction
                variant={acao.destrutiva ? "destructive" : "default"}
                onClick={() => responder(true)}
              >
                {copy.confirmar}
              </AlertDialogAction>
            </AlertDialogFooter>
          </>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}

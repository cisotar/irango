"use client";

// Zona "Excluir conta" (D8), no rodapé da navegação lateral de /minha-conta:
// botão + frase de consequência; aviso em AlertDialog + digitar EXCLUIR. O
// servidor valida a mesma palavra (`schemaExcluirConta`) e usa só o uid da sessão.
import { useId, useState } from "react";
import { toast } from "sonner";
import { Loader2, Trash2 } from "lucide-react";

import { excluirConta } from "@/lib/actions/cliente";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const PALAVRA = "EXCLUIR";

export function ExcluirConta({ soPerfil }: { soPerfil: boolean }) {
  const idCampo = useId();
  const idConsequencia = useId();
  const [aberto, setAberto] = useState(false);
  const [digitado, setDigitado] = useState("");
  const [enviando, setEnviando] = useState(false);

  const titulo = soPerfil ? "Excluir seu perfil de cliente?" : "Excluir sua conta?";
  const texto = soPerfil
    ? "Sua conta e o acesso ao painel continuam."
    : "Seus dados e endereços serão apagados. Isso não pode ser desfeito.";

  async function confirmar() {
    if (digitado !== PALAVRA) return;
    setEnviando(true);
    try {
      // Sucesso → a action encerra a sessão e redireciona para "/".
      const r = await excluirConta({ confirmacao: PALAVRA });
      if (r && !r.ok) toast.error(r.erro);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        variant="destructive"
        className="min-h-11 w-full"
        aria-describedby={idConsequencia}
        onClick={() => {
          setDigitado("");
          setAberto(true);
        }}
      >
        <Trash2 aria-hidden="true" />
        Excluir conta
      </Button>
      <p id={idConsequencia} className="px-1 text-xs text-texto-muted">
        {texto}
      </p>

      <AlertDialog
        open={aberto}
        onOpenChange={(abrir) => {
          if (!abrir && !enviando) setAberto(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{titulo}</AlertDialogTitle>
            <AlertDialogDescription>{texto}</AlertDialogDescription>
          </AlertDialogHeader>
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              void confirmar();
            }}
          >
            <Label htmlFor={idCampo}>Digite {PALAVRA} para confirmar</Label>
            <Input
              id={idCampo}
              value={digitado}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              className="min-h-11"
              onChange={(e) => setDigitado(e.target.value)}
            />
          </form>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11" disabled={enviando}>
              Cancelar
            </AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              className="min-h-11"
              disabled={digitado !== PALAVRA || enviando}
              onClick={confirmar}
            >
              {enviando && <Loader2 className="animate-spin" aria-hidden="true" />}
              Excluir conta
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

"use client";

import type { CSSProperties } from "react";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { HexColorPicker } from "react-colorful";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { PreviewVitrine } from "@/components/painel/PreviewVitrine";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { schemaTema } from "@/lib/validacoes/loja";
import type { salvarTema as salvarTemaLojista } from "@/lib/actions/loja";

export type Tema = {
  primaria: string;
  fundo: string;
  destaque: string;
};

const reHex = /^#[0-9a-fA-F]{6}$/;

const CAMPOS: { chave: keyof Tema; rotulo: string }[] = [
  { chave: "primaria", rotulo: "Cor primária" },
  { chave: "fundo", rotulo: "Cor de fundo" },
  { chave: "destaque", rotulo: "Cor de destaque" },
];

/**
 * Form de tema (issue 042). Client component.
 *
 * Preview ao vivo via CSS custom properties no wrapper (não persiste). A
 * validação hex aqui é só gate de UX — `salvarTema` (030) revalida cada cor
 * como `#RRGGBB` no servidor, prevenindo injeção de CSS.
 */
export function TemaClient({
  inicial,
  nomeLoja,
  onSalvar,
}: {
  inicial: Tema;
  nomeLoja: string;
  /** Action de salvar tema. Obrigatória: a page do painel passa a do lojista, a via admin a variante por `lojaId`. */
  onSalvar: typeof salvarTemaLojista;
}) {
  const router = useRouter();
  const [tema, setTema] = useState<Tema>(inicial);
  const [enviando, startEnvio] = useTransition();

  function atualizar(chave: keyof Tema, valor: string) {
    // react-colorful sempre devolve `#rrggbb`; campo de texto pode estar parcial.
    const normalizado = valor.startsWith("#") ? valor : `#${valor}`;
    setTema((atual) => ({ ...atual, [chave]: normalizado.toLowerCase() }));
  }

  const todasValidas = CAMPOS.every(({ chave }) => reHex.test(tema[chave]));

  function salvar() {
    const parsed = schemaTema.safeParse(tema);
    if (!parsed.success) {
      toast.error("Cada cor deve estar no formato #RRGGBB.");
      return;
    }

    startEnvio(async () => {
      const resultado = await onSalvar(parsed.data);
      if (!resultado.ok) {
        toast.error(resultado.erro);
        return;
      }
      toast.success("Tema salvo!");
      router.refresh();
    });
  }

  const estiloPreview = {
    "--cor-primaria": tema.primaria,
    "--cor-fundo": tema.fundo,
    "--cor-destaque": tema.destaque,
  } as CSSProperties;

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6">
      <h1 className="mb-6 font-heading text-xl font-semibold text-foreground">
        Tema da vitrine
      </h1>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardContent className="space-y-6 p-6">
            {CAMPOS.map(({ chave, rotulo }) => {
              const valor = tema[chave];
              const invalida = !reHex.test(valor);
              return (
                <div key={chave} className="space-y-2">
                  <Label htmlFor={`tema-${chave}`}>{rotulo}</Label>
                  <HexColorPicker
                    color={reHex.test(valor) ? valor : "#000000"}
                    onChange={(c) => atualizar(chave, c)}
                  />
                  <div className="flex items-center gap-2">
                    <span
                      className="size-8 shrink-0 rounded-md border border-input"
                      style={{ backgroundColor: reHex.test(valor) ? valor : "transparent" }}
                      aria-hidden
                    />
                    <Input
                      id={`tema-${chave}`}
                      value={valor}
                      onChange={(e) => atualizar(chave, e.target.value)}
                      placeholder="#RRGGBB"
                      aria-invalid={invalida}
                      className="font-mono"
                    />
                  </div>
                  {invalida && (
                    <p className="text-xs text-destructive">
                      Use o formato #RRGGBB.
                    </p>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <div style={estiloPreview}>
            <Dialog>
              <DialogTrigger
                className="block w-full cursor-pointer"
                aria-label="Ampliar prévia da vitrine"
              >
                <PreviewVitrine tema={tema} nomeLoja={nomeLoja} />
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>Prévia da vitrine</DialogTitle>
                  <DialogDescription className="sr-only">
                    Prévia em tamanho maior da vitrine com as cores do tema
                    atual
                  </DialogDescription>
                </DialogHeader>
                <div className="overflow-y-auto px-4 pb-4">
                  <PreviewVitrine tema={tema} nomeLoja={nomeLoja} ampliado />
                </div>
              </DialogContent>
            </Dialog>
          </div>

          <Separator />

          <Button
            type="button"
            className="w-full"
            disabled={enviando || !todasValidas}
            onClick={salvar}
          >
            {enviando && <Loader2 className="mr-2 size-4 animate-spin" />}
            Salvar
          </Button>
        </div>
      </div>
    </main>
  );
}

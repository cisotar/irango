"use client";

import type { CSSProperties } from "react";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { HexColorPicker } from "react-colorful";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { schemaTema } from "@/lib/validacoes/loja";
import { salvarTema as salvarTemaLojista } from "@/lib/actions/loja";

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
  onSalvar = salvarTemaLojista,
}: {
  inicial: Tema;
  nomeLoja: string;
  /** Action de salvar tema. Default: action do lojista. A via admin injeta a variante por `lojaId`. */
  onSalvar?: typeof salvarTemaLojista;
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
    "--preview-primaria": tema.primaria,
    "--preview-fundo": tema.fundo,
    "--preview-destaque": tema.destaque,
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
          <Card>
            <CardContent className="p-0">
              <div
                style={estiloPreview}
                className="overflow-hidden rounded-xl"
              >
                <div
                  className="p-6"
                  style={{ backgroundColor: "var(--preview-fundo)" }}
                >
                  <div
                    className="mb-3 inline-block rounded-md px-3 py-1 text-sm font-semibold text-white"
                    style={{ backgroundColor: "var(--preview-primaria)" }}
                  >
                    {nomeLoja}
                  </div>
                  <div
                    className="rounded-lg border p-4"
                    style={{ borderColor: "var(--preview-destaque)" }}
                  >
                    <p className="text-sm" style={{ color: "var(--preview-primaria)" }}>
                      Prévia da sua vitrine
                    </p>
                    <span
                      className="mt-2 inline-block rounded px-2 py-0.5 text-xs font-medium text-white"
                      style={{ backgroundColor: "var(--preview-destaque)" }}
                    >
                      Destaque
                    </span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

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

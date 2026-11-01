"use client";

// Pedido do link. A resposta é sempre a mesma (anti-enumeração) e
// aparece numa caixa neutra. Autoridade: `solicitarRedefinicaoSenha`.
import { useState } from "react";
import { useForm } from "react-hook-form";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { solicitarRedefinicaoSenha } from "@/lib/actions/recuperacaoSenha";
import { schemaRecuperacaoSenha, type EntradaRecuperacaoSenha } from "@/lib/validacoes/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertaErro, AvisoNeutro } from "@/components/cliente/Alerta";

const MSG_LINK = "Link inválido ou expirado. Peça um novo link e abra-o neste mesmo navegador.";

export function FormRecuperarSenha({ linkInvalido = false }: { linkInvalido?: boolean }) {
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<EntradaRecuperacaoSenha>({ defaultValues: { email: "" } });

  async function onSubmit({ email }: EntradaRecuperacaoSenha) {
    setErro(null);
    const r = await solicitarRedefinicaoSenha({ email });
    if (r.ok) {
      setAviso(r.mensagem);
      return;
    }
    setErro(r.erro);
    toast.error(r.erro);
  }

  return (
    <Card className="mx-auto max-w-sm">
      <CardHeader>
        <CardTitle className="text-center text-xl">Recuperar senha</CardTitle>
        <CardDescription className="text-center">Informe o e-mail da sua conta.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {linkInvalido && !aviso && <AlertaErro>{MSG_LINK}</AlertaErro>}
        {erro && <AlertaErro>{erro}</AlertaErro>}
        {aviso ? (
          <AvisoNeutro>{aviso}</AvisoNeutro>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
            <div className="space-y-2">
              <Label htmlFor="email">E-mail</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                className="min-h-11"
                aria-invalid={!!errors.email || undefined}
                aria-describedby={errors.email ? "email-erro" : undefined}
                {...register("email", {
                  validate: (v) =>
                    schemaRecuperacaoSenha.shape.email.safeParse(v).success || "Informe um e-mail válido.",
                })}
              />
              {errors.email && (
                <p id="email-erro" className="text-sm text-destructive">
                  {errors.email.message}
                </p>
              )}
            </div>
            <Button type="submit" className="min-h-11 w-full" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="animate-spin" aria-hidden="true" />}
              Enviar link
            </Button>
          </form>
        )}
        <p className="text-center text-sm">
          <Link href="/login" className="inline-flex min-h-11 items-center font-medium text-primaria underline">
            Voltar para o login
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}

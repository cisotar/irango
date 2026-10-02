"use client";

// Etapa 1: pedir o link. A resposta é sempre a mesma (anti-enumeração, B2) e
// aparece numa caixa neutra (não "sucesso"). Autoridade: `solicitarRecuperacaoCliente`.
import { useState } from "react";
import { useForm } from "react-hook-form";
import Link from "next/link";
import { Loader2 } from "lucide-react";

import { solicitarRecuperacaoCliente } from "@/lib/actions/clienteAuth";
import { schemaRecuperacaoCliente } from "@/lib/validacoes/cliente";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertaErro, AvisoNeutro } from "@/components/cliente/Alerta";
import { comNext } from "@/components/cliente/rotas";

export function FormRecuperarCliente({ next }: { next: string | undefined }) {
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<{ email: string }>({ defaultValues: { email: "" } });

  async function onSubmit({ email }: { email: string }) {
    setErro(null);
    const r = await solicitarRecuperacaoCliente({ email, next });
    if (r.ok) setAviso(r.mensagem);
    else setErro(r.erro);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-center text-xl">Recuperar senha</CardTitle>
        <CardDescription className="text-center">Informe o e-mail da sua conta.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
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
                    schemaRecuperacaoCliente.shape.email.safeParse(v).success || "Informe um e-mail válido.",
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
          <Link
            href={comNext("/conta/entrar", next)}
            className="inline-flex min-h-11 items-center font-medium text-primaria underline"
          >
            Voltar para entrar
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}

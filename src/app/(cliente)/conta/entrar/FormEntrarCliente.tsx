"use client";

// Form de /conta/entrar. Google primeiro e com mais peso visual (decisão 13,
// D2); e-mail/senha abaixo, submit em contorno. Validação aqui é só UX; a
// autoridade é `entrarCliente` (rate limit, anti-enumeração, decisão 18).
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { entrarCliente } from "@/lib/actions/clienteAuth";
import { schemaEntrarCliente } from "@/lib/validacoes/cliente";
import { BotaoGoogle } from "@/app/(auth)/BotaoGoogle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertaErro } from "@/components/cliente/Alerta";
import { MSG_CAMPO } from "@/components/cliente/mensagens";
import { CampoSenha } from "@/components/cliente/CampoSenha";
import { SeparadorOu } from "@/components/cliente/Separador";
import { comNext } from "@/components/cliente/rotas";

type Valores = { email: string; senha: string };

export function FormEntrarCliente({
  next,
  erroInicial,
}: {
  next: string | undefined;
  erroInicial: string | null;
}) {
  const router = useRouter();
  const [erro, setErro] = useState<string | null>(erroInicial);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<Valores>({ defaultValues: { email: "", senha: "" } });

  async function onSubmit(valores: Valores) {
    setErro(null);
    const parsed = schemaEntrarCliente.safeParse({ ...valores, next });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const campo = issue.path[0];
        if (campo === "email" || campo === "senha") {
          setError(campo, { message: MSG_CAMPO });
        }
      }
      return;
    }
    const r = await entrarCliente(parsed.data);
    if (r.ok) {
      router.push(r.destino);
      router.refresh();
      return;
    }
    setErro(r.erro);
    toast.error(r.erro);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-center text-xl">Entrar na sua conta</CardTitle>
      </CardHeader>
      <CardContent>
        {erro && <AlertaErro>{erro}</AlertaErro>}

        <BotaoGoogle contexto="cliente" next={next} rotulo="Continuar com Google" />

        <SeparadorOu texto="ou entre com e-mail" />

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
              {...register("email")}
            />
            {errors.email && (
              <p id="email-erro" className="text-sm text-destructive">
                {errors.email.message}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="senha">Senha</Label>
            <CampoSenha
              id="senha"
              autoComplete="current-password"
              aria-invalid={!!errors.senha || undefined}
              aria-describedby={errors.senha ? "senha-erro" : undefined}
              {...register("senha")}
            />
            {errors.senha && (
              <p id="senha-erro" className="text-sm text-destructive">
                {errors.senha.message}
              </p>
            )}
            <div className="flex justify-end">
              <Link
                href={comNext("/conta/recuperar", next)}
                className="inline-flex min-h-11 items-center text-sm font-medium text-primaria underline"
              >
                Esqueci minha senha
              </Link>
            </div>
          </div>

          <Button type="submit" variant="outline" className="min-h-11 w-full" disabled={isSubmitting}>
            {isSubmitting ? (
              <>
                <Loader2 className="animate-spin" aria-hidden="true" /> Entrando…
              </>
            ) : (
              "Entrar"
            )}
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-texto-muted">
          Não tem conta?{" "}
          <Link
            href={comNext("/conta/cadastro", next)}
            className="inline-flex min-h-11 items-center font-medium text-primaria underline"
          >
            Criar conta
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}

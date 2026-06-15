"use client";

// Form de /login (issue 034). Validação client é só UX — a autoritativa está na
// action `entrar` (seguranca.md §6). Sem @hookform/resolvers instalado → valida
// com o schema zod manualmente no submit (mesmo schema do servidor).
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Eye, EyeOff, Loader2 } from "lucide-react";

import { entrar } from "@/lib/actions/auth";
import { schemaLogin, type EntradaLogin } from "@/lib/validacoes/auth";
import { BotaoGoogle } from "@/app/(auth)/BotaoGoogle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function LoginForm({ erroOAuth = false }: { erroOAuth?: boolean }) {
  const router = useRouter();
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [erroCredencial, setErroCredencial] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<EntradaLogin>({ defaultValues: { email: "", senha: "" } });

  async function onSubmit(valores: EntradaLogin) {
    setErroCredencial(null);

    // UX: mesma validação do servidor antes de enviar.
    const parsed = schemaLogin.safeParse(valores);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const campo = issue.path[0];
        if (campo === "email" || campo === "senha") {
          setError(campo, { message: "Preencha este campo corretamente." });
        }
      }
      return;
    }

    const resultado = await entrar(parsed.data);
    if (resultado.ok) {
      router.push("/painel");
      return;
    }
    setErroCredencial(resultado.erro);
    toast.error(resultado.erro);
  }

  return (
    <Card className="mx-auto max-w-sm">
      <CardHeader>
        <CardTitle className="text-center text-xl">Entrar na sua conta</CardTitle>
      </CardHeader>
      <CardContent>
        {erroOAuth && (
          <div
            role="alert"
            className="mb-4 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            ⚠ Não foi possível entrar com o Google. Verifique sua conexão e tente novamente.
          </div>
        )}

        {erroCredencial && (
          <div
            role="alert"
            className="mb-4 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            ⚠ {erroCredencial}
          </div>
        )}

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="email">E-mail</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              aria-invalid={!!errors.email}
              {...register("email")}
            />
            {errors.email && (
              <p className="text-sm text-destructive">{errors.email.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="senha">Senha</Label>
            <div className="flex items-center gap-2">
              <Input
                id="senha"
                type={mostrarSenha ? "text" : "password"}
                autoComplete="current-password"
                aria-invalid={!!errors.senha}
                {...register("senha")}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={mostrarSenha ? "Ocultar senha" : "Mostrar senha"}
                aria-pressed={mostrarSenha}
                onClick={() => setMostrarSenha((v) => !v)}
              >
                {mostrarSenha ? <EyeOff /> : <Eye />}
              </Button>
            </div>
            {errors.senha && (
              <p className="text-sm text-destructive">{errors.senha.message}</p>
            )}
          </div>

          <Button type="submit" className="min-h-11 w-full" disabled={isSubmitting}>
            {isSubmitting ? (
              <>
                <Loader2 className="animate-spin" /> Entrando…
              </>
            ) : (
              "Entrar"
            )}
          </Button>
        </form>

        <div className="my-4 flex items-center gap-3">
          <Separator className="flex-1" />
          <span className="text-sm text-texto-muted">ou</span>
          <Separator className="flex-1" />
        </div>

        <BotaoGoogle />

        <p className="mt-6 text-center text-sm text-texto-muted">
          Não tem conta?{" "}
          <Link href="/cadastro" className="font-medium text-primaria underline">
            Cadastre-se
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}

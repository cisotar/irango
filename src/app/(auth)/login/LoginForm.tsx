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
import { entrarComGoogle } from "@/lib/auth/googleOAuth";
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

        <button
          type="button"
          onClick={entrarComGoogle}
          className="flex min-h-11 w-full items-center justify-center gap-3 rounded-md border border-[#dadce0] bg-white px-4 py-2 text-sm font-medium text-[#3c4043] shadow-sm transition-colors hover:bg-[#f8f9fa] hover:border-[#c6c6c6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615Z"/>
            <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z"/>
            <path fill="#FBBC05" d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332Z"/>
            <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.962L3.964 6.294C4.672 4.167 6.656 3.58 9 3.58Z"/>
          </svg>
          Entrar com Google
        </button>

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

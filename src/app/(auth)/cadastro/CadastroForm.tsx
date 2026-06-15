"use client";

// Form de /cadastro (issue 034). Validação client é só UX — a autoritativa está
// na action `cadastrar` (seguranca.md §6), que ignora qualquer campo injetado
// via schemaCadastro.strict(). Sem @hookform/resolvers → valida o schema zod
// manualmente no submit.
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Eye, EyeOff, Loader2 } from "lucide-react";

import { cadastrar } from "@/lib/actions/auth";
import { schemaCadastro } from "@/lib/validacoes/auth";

// Tipo do form (UX): o aceite pode estar desmarcado durante o preenchimento.
// O schemaCadastro (z.literal(true)) é a autoridade — valida no submit e no
// servidor. Mantê-los separados evita forçar `true` no estado do checkbox.
type FormCadastro = { email: string; senha: string; aceiteTermos: boolean };
import { entrarComGoogle } from "@/lib/auth/googleOAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function CadastroForm({ erroOAuth = false }: { erroOAuth?: boolean }) {
  const router = useRouter();
  const [mostrarSenha, setMostrarSenha] = useState(false);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormCadastro>({
    defaultValues: { email: "", senha: "", aceiteTermos: false },
  });

  // eslint-disable-next-line react-hooks/incompatible-library -- react-hook-form watch() é necessário para re-render condicional do checkbox
  const aceiteTermos = watch("aceiteTermos");

  async function onSubmit(valores: FormCadastro) {
    const parsed = schemaCadastro.safeParse(valores);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const campo = issue.path[0];
        if (campo === "email") {
          setError("email", { message: "Informe um e-mail válido." });
        } else if (campo === "senha") {
          setError("senha", { message: "Mínimo 8 caracteres." });
        } else if (campo === "aceiteTermos") {
          setError("aceiteTermos", {
            message: "É preciso aceitar os Termos para criar a conta.",
          });
        }
      }
      return;
    }

    const resultado = await cadastrar(parsed.data);
    if (resultado.ok) {
      toast.success("Loja criada! Configure seu perfil.");
      router.push("/painel/configuracoes/perfil");
      return;
    }
    toast.error(resultado.erro);
  }

  return (
    <Card className="mx-auto max-w-sm">
      <CardHeader>
        <CardTitle className="text-center text-xl">Crie sua loja grátis</CardTitle>
        <p className="text-center text-sm text-texto-muted">
          Comece a receber pedidos hoje.
        </p>
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
                autoComplete="new-password"
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
            <p className="text-xs text-texto-muted">Mínimo 8 caracteres.</p>
            {errors.senha && (
              <p className="text-sm text-destructive">{errors.senha.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-start gap-2">
              <Checkbox
                id="aceiteTermos"
                checked={aceiteTermos === true}
                onCheckedChange={(checked) =>
                  setValue("aceiteTermos", checked === true, {
                    shouldValidate: false,
                  })
                }
                aria-invalid={!!errors.aceiteTermos}
              />
              <Label htmlFor="aceiteTermos" className="text-sm leading-snug font-normal">
                Li e aceito os{" "}
                <Link
                  href="/termos"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primaria underline"
                >
                  Termos de Uso
                </Link>{" "}
                e a{" "}
                <Link
                  href="/privacidade"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primaria underline"
                >
                  Política de Privacidade
                </Link>
                .
              </Label>
            </div>
            {errors.aceiteTermos && (
              <p className="text-sm text-destructive">{errors.aceiteTermos.message}</p>
            )}
          </div>

          <Button
            type="submit"
            className="min-h-11 w-full"
            disabled={isSubmitting || aceiteTermos !== true}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="animate-spin" /> Criando conta…
              </>
            ) : (
              "Criar conta grátis"
            )}
          </Button>
        </form>

        <div className="my-4 flex items-center gap-3">
          <Separator className="flex-1" />
          <span className="text-sm text-texto-muted">ou</span>
          <Separator className="flex-1" />
        </div>

        <Button
          type="button"
          variant="outline"
          className="min-h-11 w-full"
          onClick={entrarComGoogle}
        >
          Entrar com Google
        </Button>

        <p className="mt-6 text-center text-sm text-texto-muted">
          Já tem conta?{" "}
          <Link href="/login" className="font-medium text-primaria underline">
            Entrar
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}

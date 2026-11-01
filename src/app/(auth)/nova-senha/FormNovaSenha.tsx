"use client";

// Nova senha + confirmação (8–72, regra do cadastro). Só renderizado com sessão
// de recuperação; a autoridade e o destino pós-troca vêm de `confirmarNovaSenha`.
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { confirmarNovaSenha } from "@/lib/actions/recuperacaoSenha";
import { schemaNovaSenha, type EntradaNovaSenha } from "@/lib/validacoes/auth";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertaErro } from "@/components/cliente/Alerta";
import { CampoSenha } from "@/components/cliente/CampoSenha";
import { mensagemErroSenha } from "@/components/cliente/mensagens";

export function FormNovaSenha() {
  const router = useRouter();
  const [erro, setErro] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<EntradaNovaSenha>({ defaultValues: { senha: "", confirmacao: "" } });

  async function onSubmit(valores: EntradaNovaSenha) {
    setErro(null);
    const parsed = schemaNovaSenha.safeParse(valores);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const campo = issue.path[0];
        if (campo === "confirmacao") setError("confirmacao", { message: issue.message });
        if (campo === "senha") setError("senha", { message: mensagemErroSenha(valores.senha) });
      }
      return;
    }
    const r = await confirmarNovaSenha(parsed.data);
    if (r.ok) {
      router.push(r.destino);
      router.refresh();
      return;
    }
    setErro(r.erro);
    toast.error(r.erro);
  }

  return (
    <Card className="mx-auto max-w-sm">
      <CardHeader>
        <CardTitle className="text-center text-xl">Nova senha</CardTitle>
      </CardHeader>
      <CardContent>
        {erro && <AlertaErro>{erro}</AlertaErro>}
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="senha">Nova senha</Label>
            <CampoSenha
              id="senha"
              autoComplete="new-password"
              aria-invalid={!!errors.senha || undefined}
              aria-describedby={errors.senha ? "senha-erro" : "senha-dica"}
              {...register("senha")}
            />
            {errors.senha ? (
              <p id="senha-erro" className="text-sm text-destructive">
                {errors.senha.message}
              </p>
            ) : (
              <p id="senha-dica" className="text-sm text-texto-muted">
                Mínimo de 8 caracteres.
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirmacao">Confirme a nova senha</Label>
            <CampoSenha
              id="confirmacao"
              autoComplete="new-password"
              aria-invalid={!!errors.confirmacao || undefined}
              aria-describedby={errors.confirmacao ? "confirmacao-erro" : undefined}
              {...register("confirmacao")}
            />
            {errors.confirmacao && (
              <p id="confirmacao-erro" className="text-sm text-destructive">
                {errors.confirmacao.message}
              </p>
            )}
          </div>
          <Button type="submit" className="min-h-11 w-full" disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="animate-spin" aria-hidden="true" />}
            Salvar nova senha
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

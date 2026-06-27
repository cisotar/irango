"use client";

// Form de criação de loja pelo admin (issue 098). Validação client é só UX — a
// autoritativa está na action `criarLojaAdmin` (087), que ignora qualquer campo
// injetado (schemaNovaLojaAdmin.strict()), resolve `dono_id` por e-mail e impõe
// unicidade de slug no banco. Sem @hookform/resolvers (ausente no projeto) →
// valida o schema zod manualmente no submit, igual a CadastroForm/LoginForm.
import { useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { schemaNovaLojaAdmin, sanitizarSlug } from "@/lib/validacoes/loja";
import { criarLojaAdmin } from "../actions";

type FormNovaLoja = { email: string; nome: string; slug: string };

export function FormNovaLoja() {
  const router = useRouter();

  const {
    register,
    handleSubmit,
    setValue,
    setError,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormNovaLoja>({
    defaultValues: { email: "", nome: "", slug: "" },
  });

  const nome = watch("nome");
  // Slug derivado do nome enquanto o usuário não o editou manualmente (preview de
  // UX). Depois de uma edição manual, paramos de sobrescrever para não atropelar
  // a escolha do admin. A unicidade real é decidida no servidor (087).
  const slugTocado = useRef(false);

  useEffect(() => {
    if (slugTocado.current) return;
    setValue("slug", sanitizarSlug(nome ?? ""), { shouldValidate: false });
  }, [nome, setValue]);

  async function onSubmit(valores: FormNovaLoja): Promise<void> {
    const parsed = schemaNovaLojaAdmin.safeParse(valores);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const campo = issue.path[0];
        if (campo === "email") {
          setError("email", { message: "Informe um e-mail válido." });
        } else if (campo === "nome") {
          setError("nome", { message: "O nome deve ter entre 3 e 60 caracteres." });
        } else if (campo === "slug") {
          setError("slug", {
            message:
              "Use 3 a 60 caracteres: apenas letras minúsculas, números e hífen.",
          });
        }
      }
      return;
    }

    const resultado = await criarLojaAdmin(parsed.data);
    if (resultado.ok) {
      toast.success("Loja criada!");
      router.push(`/admin/assinantes/${resultado.lojaId}`);
      return;
    }
    toast.error(resultado.erro);
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="max-w-md space-y-4"
      noValidate
    >
      <div className="space-y-1.5">
        <Label htmlFor="email">E-mail do lojista</Label>
        <Input
          id="email"
          type="email"
          autoComplete="off"
          placeholder="dono@exemplo.com"
          aria-invalid={!!errors.email}
          aria-describedby={errors.email ? "erro-email" : undefined}
          {...register("email")}
        />
        <p className="text-xs text-muted-foreground">
          Precisa ser uma conta já cadastrada na plataforma.
        </p>
        {errors.email && (
          <p id="erro-email" role="alert" className="text-sm text-destructive">
            {errors.email.message}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="nome">Nome da loja</Label>
        <Input
          id="nome"
          autoComplete="off"
          placeholder="Lanchonete do Zé"
          aria-invalid={!!errors.nome}
          aria-describedby={errors.nome ? "erro-nome" : undefined}
          {...register("nome")}
        />
        {errors.nome && (
          <p id="erro-nome" role="alert" className="text-sm text-destructive">
            {errors.nome.message}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="slug">Endereço (slug)</Label>
        <Input
          id="slug"
          autoComplete="off"
          placeholder="lanchonete-do-ze"
          aria-invalid={!!errors.slug}
          aria-describedby="ajuda-slug"
          {...register("slug", {
            onChange: () => {
              slugTocado.current = true;
            },
          })}
        />
        <p id="ajuda-slug" className="text-xs text-muted-foreground">
          Sugerido a partir do nome. A loja ficará em /loja/{watch("slug") || "slug"}.
        </p>
        {errors.slug && (
          <p role="alert" className="text-sm text-destructive">
            {errors.slug.message}
          </p>
        )}
      </div>

      <Button type="submit" className="w-full" disabled={isSubmitting}>
        {isSubmitting && <Loader2 className="animate-spin" aria-hidden />}
        Criar loja
      </Button>
    </form>
  );
}

"use client";

// Form de /conta/cadastro: SÓ e-mail e senha (RN-06). Submit válido abre o
// modal da decisão 13 (persuasão, não trava de segurança) e nada é enviado
// antes de "Prosseguir com e-mail". Depois, estado "Confirme seu e-mail" (D4)
// com "Reenviar link" liberado após 60 s. Autoridade: `cadastrarCliente`.
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { cadastrarCliente, reenviarConfirmacaoCliente } from "@/lib/actions/clienteAuth";
import { schemaCadastroCliente } from "@/lib/validacoes/cliente";
import { BotaoGoogle } from "@/app/(auth)/BotaoGoogle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AlertaErro } from "@/components/cliente/Alerta";
import { CampoSenha } from "@/components/cliente/CampoSenha";
import { SeparadorOu } from "@/components/cliente/Separador";
import { comNext } from "@/components/cliente/rotas";

type Valores = { email: string; senha: string };

const ESPERA_REENVIO_MS = 60_000;
const ROTULO_GOOGLE = "Continuar com Google";

const validarEmail = (v: string) =>
  schemaCadastroCliente.shape.email.safeParse(v).success || "Informe um e-mail válido.";
const validarSenha = (v: string) =>
  schemaCadastroCliente.shape.senha.safeParse(v).success ||
  (v.length < 8 ? "Mínimo de 8 caracteres." : "Preencha este campo corretamente.");

const mensagemEnviado = (email: string) =>
  `Se ${email} estiver cadastrado, receberá um link para confirmar.`;

export function FormCadastroCliente({ next }: { next: string | undefined }) {
  const [modalAberto, setModalAberto] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [emailEnviado, setEmailEnviado] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors },
  } = useForm<Valores>({ mode: "onChange", defaultValues: { email: "", senha: "" } });

  async function prosseguirComEmail() {
    const parsed = schemaCadastroCliente.safeParse({ ...getValues(), next });
    if (!parsed.success) {
      setModalAberto(false);
      return;
    }
    setErro(null);
    setEnviando(true);
    try {
      const r = await cadastrarCliente(parsed.data);
      setModalAberto(false);
      if (r.ok) setEmailEnviado(parsed.data.email);
      else {
        setErro(r.erro);
        toast.error(r.erro);
      }
    } finally {
      setEnviando(false);
    }
  }

  if (emailEnviado) {
    return <ConfirmeSeuEmail email={emailEnviado} next={next} />;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-center text-xl">Criar sua conta</CardTitle>
      </CardHeader>
      <CardContent>
        {erro && <AlertaErro>{erro}</AlertaErro>}

        <BotaoGoogle contexto="cliente" next={next} rotulo={ROTULO_GOOGLE} />

        <SeparadorOu texto="ou cadastre-se com e-mail" />

        {/* Submit válido só ABRE o modal; nada é enviado aqui. */}
        <form onSubmit={handleSubmit(() => setModalAberto(true))} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="email">E-mail</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              className="min-h-11"
              aria-invalid={!!errors.email || undefined}
              aria-describedby={errors.email ? "email-erro" : undefined}
              {...register("email", { validate: validarEmail })}
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
              autoComplete="new-password"
              aria-invalid={!!errors.senha || undefined}
              aria-describedby={errors.senha ? "senha-erro" : "senha-ajuda"}
              {...register("senha", { validate: validarSenha })}
            />
            {errors.senha ? (
              <p id="senha-erro" className="text-sm text-destructive">
                {errors.senha.message}
              </p>
            ) : (
              <p id="senha-ajuda" className="text-sm text-texto-muted">
                Mínimo de 8 caracteres.
              </p>
            )}
          </div>

          <Button type="submit" variant="outline" className="min-h-11 w-full">
            Criar conta com e-mail
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-texto-muted">
          Já tem conta?{" "}
          <Link
            href={comNext("/conta/entrar", next)}
            className="inline-flex min-h-11 items-center font-medium text-primaria underline"
          >
            Entrar
          </Link>
        </p>
      </CardContent>

      <AlertDialog
        open={modalAberto}
        onOpenChange={(abrir) => {
          // Esc / clique fora: volta ao formulário sem enviar.
          if (!abrir && !enviando) setModalAberto(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Tem certeza que quer usar essa forma de cadastro?</AlertDialogTitle>
            <AlertDialogDescription>
              Prefira cadastrar-se com sua conta Google: é mais seguro, mais rápido e mais prático.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {/* Google primeiro no DOM: recebe o foco inicial e fica em cima no mobile. */}
          <AlertDialogFooter className="flex-col gap-2 sm:flex-col">
            <BotaoGoogle contexto="cliente" next={next} rotulo={ROTULO_GOOGLE} />
            <Button
              type="button"
              variant="outline"
              className="min-h-11 w-full"
              disabled={enviando}
              onClick={prosseguirComEmail}
            >
              {enviando && <Loader2 className="animate-spin" aria-hidden="true" />}
              Prosseguir com e-mail
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

/** Estado pós-cadastro (D4): sem sessão; reenvio liberado após 60 s. */
function ConfirmeSeuEmail({ email, next }: { email: string; next: string | undefined }) {
  const [liberado, setLiberado] = useState(false);
  const [ciclo, setCiclo] = useState(0);
  const [reenviando, setReenviando] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setLiberado(true), ESPERA_REENVIO_MS);
    return () => clearTimeout(t);
  }, [ciclo]);

  async function reenviar() {
    setReenviando(true);
    try {
      const r = await reenviarConfirmacaoCliente({ email, next });
      if (r.ok) {
        toast.success(mensagemEnviado(email));
        setLiberado(false);
        setCiclo((c) => c + 1);
      } else {
        toast.error(r.erro);
      }
    } finally {
      setReenviando(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-center text-xl">Confirme seu e-mail</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p role="status" className="text-sm text-texto">
          {mensagemEnviado(email)}
        </p>
        <Button
          type="button"
          variant="outline"
          className="min-h-11 w-full"
          disabled={!liberado || reenviando}
          onClick={reenviar}
        >
          {reenviando && <Loader2 className="animate-spin" aria-hidden="true" />}
          Reenviar link
        </Button>
      </CardContent>
    </Card>
  );
}

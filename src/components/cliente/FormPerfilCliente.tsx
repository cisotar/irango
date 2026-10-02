"use client";

// Perfil do cliente (specs/cliente-identidade.md): passo complementar
// (`/conta/completar`, com 1º endereço + aceite) e edição em `/minha-conta`.
// Validação aqui é só UX, com os MESMOS schemas do servidor; a autoridade é a
// Server Action (id da sessão, versão dos termos do servidor, idade no banco).
import { useCallback, useId, useState, type FormEvent } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Info, Loader2 } from "lucide-react";

import { completarPerfilCliente, salvarPerfilCliente } from "@/lib/actions/cliente";
import {
  schemaPerfilCliente,
  schemaEnderecoCliente,
  validarDataNascimento,
  type EntradaEnderecoCliente,
} from "@/lib/validacoes/cliente";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CampoTelefone } from "@/components/cliente/CampoTelefone";
import { BlocoEndereco } from "@/components/cliente/BlocoEndereco";
import { AlertaErro } from "@/components/cliente/Alerta";
import { MSG_CAMPO } from "@/components/cliente/mensagens";

const MSG_DADOS = "Verifique os dados informados.";
const MSG_ACEITE = "Aceite os termos para continuar.";

type ValoresPerfil = {
  nome: string;
  telefone: string;
  data_nascimento: string;
  aceita_marketing: boolean;
};

type Erros = Partial<Record<"nome" | "telefone" | "data_nascimento" | "aceite", string>>;

type Props =
  | {
      modo: "completar";
      nomeInicial: string;
      /** Lojista/admin ativando o perfil: mostra "Seu acesso ao painel continua o mesmo." */
      avisoPainel: boolean;
      next?: string;
    }
  | { modo: "editar"; inicial: ValoresPerfil };

function validarPerfil(v: ValoresPerfil): Erros {
  const erros: Erros = {};
  const shape = schemaPerfilCliente.shape;
  if (!shape.nome.safeParse(v.nome).success) erros.nome = MSG_CAMPO;
  if (!shape.telefone.safeParse(v.telefone).success) erros.telefone = MSG_CAMPO;
  const erroData = validarDataNascimento(v.data_nascimento);
  if (erroData) erros.data_nascimento = erroData;
  return erros;
}

export function FormPerfilCliente(props: Props) {
  const uid = useId();
  const id = (campo: string) => `${uid}-${campo}`;

  const [valores, setValores] = useState<ValoresPerfil>(
    props.modo === "editar"
      ? props.inicial
      : { nome: props.nomeInicial, telefone: "", data_nascimento: "", aceita_marketing: false },
  );
  const [endereco, setEndereco] = useState<EntradaEnderecoCliente | null>(null);
  const [aceite, setAceite] = useState(false);
  const [erros, setErros] = useState<Erros>({});
  const [erroGeral, setErroGeral] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const aoMudarEndereco = useCallback((e: EntradaEnderecoCliente | null) => setEndereco(e), []);

  function campo<K extends keyof ValoresPerfil>(chave: K, valor: ValoresPerfil[K]) {
    setValores((v) => ({ ...v, [chave]: valor }));
  }

  async function enviar(evento: FormEvent) {
    evento.preventDefault();
    setErroGeral(null);

    const novosErros = validarPerfil(valores);
    if (props.modo === "completar" && !aceite) novosErros.aceite = MSG_ACEITE;
    const enderecoValido =
      props.modo === "editar" || (endereco !== null && schemaEnderecoCliente.safeParse(endereco).success);
    setErros(novosErros);
    if (Object.keys(novosErros).length > 0 || !enderecoValido) {
      if (!enderecoValido) setErroGeral(MSG_DADOS);
      return;
    }

    setEnviando(true);
    try {
      if (props.modo === "completar") {
        // Sucesso → a action redireciona (next sanitizado ou /minha-conta).
        const r = await completarPerfilCliente({
          ...valores,
          aceiteTermos: true,
          endereco,
          next: props.next,
        });
        if (r && !r.ok) {
          setErroGeral(r.erro);
          toast.error(r.erro);
        }
      } else {
        const r = await salvarPerfilCliente(valores);
        if (r.ok) toast.success("Alterações salvas.");
        else {
          setErroGeral(r.erro);
          toast.error(r.erro);
        }
      }
    } finally {
      setEnviando(false);
    }
  }

  const formId = id("form");
  const erroCampo = (chave: keyof Erros) =>
    erros[chave] ? (
      <p id={id(`${chave}-erro`)} className="text-sm text-destructive">
        {erros[chave]}
      </p>
    ) : null;

  return (
    <div className="flex flex-col gap-5">
      {props.modo === "completar" && props.avisoPainel && (
        <p className="flex items-start gap-2 rounded-md bg-muted px-3 py-2 text-sm text-texto">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          Seu acesso ao painel continua o mesmo.
        </p>
      )}

      {erroGeral && <AlertaErro>{erroGeral}</AlertaErro>}

      {/* FormEndereco tem o próprio <form>: o bloco de endereço fica FORA deste
          form (sem form aninhado) e o botão final aponta para ele via `form=`. */}
      <form id={formId} onSubmit={enviar} noValidate className="flex flex-col gap-4">
        <div className="space-y-2">
          <Label htmlFor={id("nome")}>Nome</Label>
          <Input
            id={id("nome")}
            autoComplete="name"
            maxLength={120}
            className="min-h-11"
            value={valores.nome}
            onChange={(e) => campo("nome", e.target.value)}
            aria-invalid={!!erros.nome || undefined}
            aria-describedby={erros.nome ? id("nome-erro") : undefined}
          />
          {erroCampo("nome")}
        </div>

        <div className="space-y-2">
          <Label htmlFor={id("telefone")}>Telefone</Label>
          <CampoTelefone
            id={id("telefone")}
            value={valores.telefone}
            onChange={(v) => campo("telefone", v)}
            invalido={!!erros.telefone}
            descricaoId={id("telefone-erro")}
          />
          {erroCampo("telefone")}
        </div>

        <div className="space-y-2">
          <Label htmlFor={id("nascimento")}>Data de nascimento</Label>
          <Input
            id={id("nascimento")}
            type="date"
            autoComplete="bday"
            className="min-h-11"
            value={valores.data_nascimento}
            onChange={(e) => campo("data_nascimento", e.target.value)}
            aria-invalid={!!erros.data_nascimento || undefined}
            aria-describedby={erros.data_nascimento ? id("data_nascimento-erro") : undefined}
          />
          {erroCampo("data_nascimento")}
        </div>
      </form>

      {props.modo === "completar" && (
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-2 text-sm font-medium text-texto">Endereço</legend>
          <BlocoEndereco onChange={aoMudarEndereco} />
        </fieldset>
      )}

      <div className="flex flex-col gap-2">
        <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm text-texto">
          <Checkbox
            checked={valores.aceita_marketing}
            onCheckedChange={(v) => campo("aceita_marketing", v === true)}
          />
          Quero receber promoções por e-mail
        </label>

        {props.modo === "completar" && (
          <div>
            <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm text-texto">
              <Checkbox
                checked={aceite}
                onCheckedChange={(v) => setAceite(v === true)}
                aria-invalid={!!erros.aceite || undefined}
                aria-describedby={erros.aceite ? id("aceite-erro") : undefined}
              />
              <span>
                Aceito os{" "}
                <Link href="/termos" target="_blank" rel="noopener" className="font-medium text-primaria underline">
                  Termos de Uso
                </Link>{" "}
                e a{" "}
                <Link href="/privacidade" target="_blank" rel="noopener" className="font-medium text-primaria underline">
                  Política de Privacidade
                </Link>
              </span>
            </label>
            {erroCampo("aceite")}
          </div>
        )}
      </div>

      <Button type="submit" form={formId} className="min-h-11 w-full" disabled={enviando}>
        {enviando && <Loader2 className="animate-spin" aria-hidden="true" />}
        {props.modo === "completar" ? "Salvar e continuar" : "Salvar alterações"}
      </Button>
    </div>
  );
}

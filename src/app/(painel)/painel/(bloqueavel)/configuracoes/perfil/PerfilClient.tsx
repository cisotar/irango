"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { IMaskInput } from "react-imask";
import { Copy, Loader2, Search } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { schemaPerfil, sanitizarSlug } from "@/lib/validacoes/loja";
import {
  salvarPerfil as salvarPerfilLojista,
  definirPublicacao as definirPublicacaoLojista,
} from "@/lib/actions/loja";
import { buscarCep } from "@/lib/utils/buscarCep";
import {
  UploadLogoLoja,
  type UploadLogoLojaProps,
} from "@/components/painel/UploadLogoLoja";

export type PerfilInicial = {
  nome: string;
  slug: string;
  telefone: string | null;
  whatsapp: string | null;
  endereco_cep: string | null;
  endereco_rua: string | null;
  endereco_numero: string | null;
  endereco_bairro: string | null;
  endereco_cidade: string | null;
  endereco_estado: string | null;
};

const BASE_VITRINE = "https://irango.com.br/loja";

/** Mantém apenas dígitos. */
function apenasDigitos(s: string): string {
  return s.replace(/\D/g, "");
}

/**
 * Converte o WhatsApp armazenado (`55DDXXXXXXXXX`) para o número nacional
 * exibido na máscara `(DD) XXXXX-XXXX` (sem o prefixo 55).
 */
function whatsappArmazenadoParaExibicao(armazenado: string | null): string {
  if (!armazenado) return "";
  const d = apenasDigitos(armazenado);
  return d.startsWith("55") ? d.slice(2) : d;
}

const className =
  "flex h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50";

/**
 * Form de perfil (issue 040). Client component.
 *
 * As máscaras (telefone/WhatsApp) são UX; o WhatsApp é normalizado para
 * `55DDXXXXXXXXX` antes do submit. O mesmo `schemaPerfil` do servidor valida
 * aqui só como gate — a Server Action revalida e checa unicidade de slug.
 */
export function PerfilClient({
  inicial,
  publicado,
  podePublicar,
  logoUrlInicial,
  onSalvar = salvarPerfilLojista,
  onDefinirPublicacao = definirPublicacaoLojista,
  onSalvarLogo,
  onRemoverLogo,
}: {
  inicial: PerfilInicial;
  publicado: boolean;
  podePublicar: boolean;
  logoUrlInicial: string | null;
  /** Action de salvar perfil. Default: action do lojista. A via admin injeta a variante por `lojaId`. */
  onSalvar?: typeof salvarPerfilLojista;
  /** Action de publicar/despublicar. Default: action do lojista. */
  onDefinirPublicacao?: typeof definirPublicacaoLojista;
  /** Action de salvar a logo. Default (ausente): action do lojista via UploadLogoLoja. */
  onSalvarLogo?: UploadLogoLojaProps["onSalvar"];
  /** Action de remover a logo. Default (ausente): action do lojista via UploadLogoLoja. */
  onRemoverLogo?: UploadLogoLojaProps["onRemover"];
}) {
  const router = useRouter();

  const [nome, setNome] = useState(inicial.nome);
  const [slug, setSlug] = useState(inicial.slug);
  const [slugEditadoManualmente, setSlugEditadoManualmente] = useState(false);
  const [telefone, setTelefone] = useState(
    whatsappArmazenadoParaExibicao(inicial.telefone),
  );
  const [whatsapp, setWhatsapp] = useState(
    whatsappArmazenadoParaExibicao(inicial.whatsapp),
  );

  // Endereço da loja (issue 009). Coords NÃO entram no form (derivadas no
  // servidor, issue 008). Pré-preenchido a partir do `inicial`.
  const [enderecoCep, setEnderecoCep] = useState(inicial.endereco_cep ?? "");
  const [enderecoRua, setEnderecoRua] = useState(inicial.endereco_rua ?? "");
  const [enderecoNumero, setEnderecoNumero] = useState(
    inicial.endereco_numero ?? "",
  );
  const [enderecoBairro, setEnderecoBairro] = useState(
    inicial.endereco_bairro ?? "",
  );
  const [enderecoCidade, setEnderecoCidade] = useState(
    inicial.endereco_cidade ?? "",
  );
  const [enderecoEstado, setEnderecoEstado] = useState(
    inicial.endereco_estado ?? "",
  );
  const [erroCep, setErroCep] = useState<string | null>(null);
  const [buscandoCep, setBuscandoCep] = useState(false);
  const numeroRef = useRef<HTMLInputElement>(null);

  const [enviando, startEnvio] = useTransition();
  const [publicando, startPublicacao] = useTransition();

  // Alterna ativo via Server Action (service_role). O servidor revalida o perfil
  // mínimo — aqui o botão fica desabilitado como gate de UX (paridade, não fonte).
  function alternarPublicacao() {
    startPublicacao(async () => {
      const r = await onDefinirPublicacao(!publicado);
      if (!r.ok) {
        toast.error(r.erro);
        return;
      }
      toast.success(publicado ? "Loja despublicada." : "Loja publicada!");
      router.refresh();
    });
  }

  const urlVitrine = `${BASE_VITRINE}/${slug}`;
  const slugValido = schemaPerfil.shape.slug.safeParse(slug).success;
  const slugMudou = slug !== inicial.slug;

  // Auto-sugestão: enquanto o lojista não editar o slug manualmente, mudar o nome
  // recalcula o slug via sanitizarSlug (cuja saída sempre passa no reSlug do schema).
  function alterarNome(novoNome: string) {
    setNome(novoNome);
    if (!slugEditadoManualmente) {
      setSlug(sanitizarSlug(novoNome));
    }
  }

  function alterarSlug(valor: string) {
    setSlugEditadoManualmente(true);
    setSlug(valor);
  }

  // Autocomplete ViaCEP (mesmo padrão de FormEndereco). Preview de UX — o
  // servidor revalida e deriva coords (issue 008). Edição manual permitida.
  async function buscarEnderecoPorCep() {
    setBuscandoCep(true);
    setErroCep(null);
    const dados = await buscarCep(enderecoCep);
    setBuscandoCep(false);
    if (dados == null) {
      setErroCep("CEP não encontrado");
      return;
    }
    setEnderecoRua(dados.rua);
    setEnderecoBairro(dados.bairro);
    setEnderecoCidade(dados.cidade);
    setEnderecoEstado(dados.uf);
    numeroRef.current?.focus();
  }

  function montarPayload() {
    const whatsappDigitos = apenasDigitos(whatsapp);
    const telefoneDigitos = apenasDigitos(telefone);
    return {
      nome: nome.trim(),
      slug: slug.trim(),
      ...(telefoneDigitos ? { telefone: telefoneDigitos } : {}),
      ...(whatsappDigitos ? { whatsapp: `55${whatsappDigitos}` } : {}),
      ...(enderecoCep.trim() ? { endereco_cep: enderecoCep.trim() } : {}),
      ...(enderecoRua.trim() ? { endereco_rua: enderecoRua.trim() } : {}),
      ...(enderecoNumero.trim() ? { endereco_numero: enderecoNumero.trim() } : {}),
      ...(enderecoBairro.trim() ? { endereco_bairro: enderecoBairro.trim() } : {}),
      ...(enderecoCidade.trim() ? { endereco_cidade: enderecoCidade.trim() } : {}),
      ...(enderecoEstado.trim() ? { endereco_estado: enderecoEstado.trim() } : {}),
    };
  }

  function salvar() {
    const payload = montarPayload();

    const parsed = schemaPerfil.safeParse(payload);
    if (!parsed.success) {
      toast.error("Confira os dados do perfil.");
      return;
    }

    startEnvio(async () => {
      const resultado = await onSalvar(parsed.data);
      if (!resultado.ok) {
        toast.error(resultado.erro);
        return;
      }
      toast.success("Perfil salvo!");
      if (!resultado.geocodificado) {
        // (008) Aviso acionável conforme o motivo (issue 007): transitório =
        // re-salvar resolve; não-encontrado = corrigir o dado. Sem motivo
        // (compat) mantém o texto antigo.
        if (resultado.motivo === "transitorio") {
          toast.warning(
            "Não conseguimos localizar seu endereço agora. Tente salvar novamente em instantes para ativar as zonas por raio.",
          );
        } else {
          toast.warning(
            "Não localizamos seu endereço no mapa — confira rua, número e CEP. Zonas por raio ficam inativas até corrigir.",
          );
        }
      }
      router.refresh();
    });
  }

  async function copiarLink() {
    try {
      await navigator.clipboard.writeText(urlVitrine);
      toast.success("Link copiado!");
    } catch {
      toast.error("Não foi possível copiar o link.");
    }
  }

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-6">
      <h1 className="mb-6 font-heading text-xl font-semibold text-foreground">
        Perfil da loja
      </h1>

      {/* Publicação da vitrine: a loja nasce em rascunho (oculta). Publicar exige
          nome + WhatsApp (gate validado no servidor por definirPublicacao). */}
      <Card className="mb-4">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-6">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="font-medium text-foreground">Status da vitrine</span>
              {publicado ? (
                <Badge variant="secondary">No ar</Badge>
              ) : (
                <Badge variant="outline">Rascunho</Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {publicado
                ? "Sua vitrine está visível e aceitando pedidos."
                : podePublicar
                  ? "Sua vitrine está oculta. Publique para receber pedidos."
                  : "Preencha nome e WhatsApp e salve antes de publicar."}
            </p>
          </div>
          <Button
            type="button"
            variant={publicado ? "outline" : "default"}
            disabled={publicando || (!publicado && !podePublicar)}
            onClick={alternarPublicacao}
          >
            {publicando && <Loader2 className="mr-2 size-4 animate-spin" />}
            {publicado ? "Despublicar" : "Publicar loja"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-6">
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              salvar();
            }}
          >
            <div className="space-y-1">
              <UploadLogoLoja
                logoUrlInicial={logoUrlInicial}
                onSalvar={onSalvarLogo}
                onRemover={onRemoverLogo}
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="perfil-nome">Nome da loja</Label>
              <Input
                id="perfil-nome"
                value={nome}
                onChange={(e) => alterarNome(e.target.value)}
                placeholder="Ex.: Burguer do Zé"
                required
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="perfil-whatsapp">WhatsApp</Label>
              <IMaskInput
                id="perfil-whatsapp"
                mask="(00) 00000-0000"
                value={whatsapp}
                onAccept={(value) => setWhatsapp(value as string)}
                placeholder="(00) 00000-0000"
                inputMode="tel"
                className={className}
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="perfil-telefone">Telefone (opcional)</Label>
              <IMaskInput
                id="perfil-telefone"
                mask="(00) 00000-0000"
                value={telefone}
                onAccept={(value) => setTelefone(value as string)}
                placeholder="(00) 00000-0000"
                inputMode="tel"
                className={className}
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="perfil-slug">Link da sua vitrine</Label>
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-full items-center rounded-lg border border-input bg-background pl-2.5 text-sm focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
                  <span className="shrink-0 text-muted-foreground">
                    irango.com.br/loja/
                  </span>
                  <input
                    id="perfil-slug"
                    value={slug}
                    onChange={(e) => alterarSlug(e.target.value)}
                    placeholder="minha-loja"
                    aria-invalid={!slugValido}
                    className="h-full w-full bg-transparent pr-2.5 text-foreground outline-none placeholder:text-muted-foreground"
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label="Copiar link da vitrine"
                  onClick={copiarLink}
                >
                  <Copy className="size-4" />
                </Button>
              </div>
              {!slugValido && (
                <p className="text-xs text-destructive">
                  O link deve ter de 3 a 60 caracteres, apenas letras minúsculas,
                  números e hífens.
                </p>
              )}
              {slugValido && slugMudou && (
                <p className="text-xs text-amber-600 dark:text-amber-500">
                  Atenção: o link anterior da vitrine deixará de funcionar.
                </p>
              )}
            </div>

            <Separator />

            {/* Endereço da loja (issue 009). Coords NÃO entram aqui — derivadas
                no servidor (issue 008). Autocomplete ViaCEP é preview de UX. */}
            <div className="space-y-3">
              <div className="space-y-1">
                <p className="font-medium text-foreground">Endereço da loja</p>
                <p className="text-xs text-muted-foreground">
                  Usado para calcular zonas de entrega por raio.
                </p>
              </div>

              <div className="space-y-1">
                <Label htmlFor="perfil-endereco-cep">CEP</Label>
                <div className="flex items-center gap-2">
                  <IMaskInput
                    id="perfil-endereco-cep"
                    mask="00000-000"
                    value={enderecoCep}
                    onAccept={(value) => setEnderecoCep(value as string)}
                    placeholder="00000-000"
                    inputMode="numeric"
                    aria-invalid={erroCep != null}
                    aria-describedby={
                      erroCep != null ? "perfil-endereco-cep-erro" : undefined
                    }
                    className={className}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="shrink-0"
                    onClick={buscarEnderecoPorCep}
                    disabled={buscandoCep}
                  >
                    {buscandoCep ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                    ) : (
                      <Search className="size-4" aria-hidden />
                    )}
                    {buscandoCep ? "Buscando…" : "Buscar"}
                  </Button>
                </div>
                {erroCep != null && (
                  <p
                    id="perfil-endereco-cep-erro"
                    className="text-xs text-destructive"
                  >
                    {erroCep} Confira e tente de novo, ou preencha manualmente.
                  </p>
                )}
              </div>

              <div className="space-y-1">
                <Label htmlFor="perfil-endereco-rua">Logradouro</Label>
                <Input
                  id="perfil-endereco-rua"
                  value={enderecoRua}
                  onChange={(e) => setEnderecoRua(e.target.value)}
                  placeholder="Rua, avenida…"
                />
              </div>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[6rem_1fr]">
                <div className="space-y-1">
                  <Label htmlFor="perfil-endereco-numero">Número</Label>
                  <Input
                    id="perfil-endereco-numero"
                    ref={numeroRef}
                    value={enderecoNumero}
                    inputMode="numeric"
                    onChange={(e) => setEnderecoNumero(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="perfil-endereco-bairro">Bairro</Label>
                  <Input
                    id="perfil-endereco-bairro"
                    value={enderecoBairro}
                    onChange={(e) => setEnderecoBairro(e.target.value)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_5rem]">
                <div className="space-y-1">
                  <Label htmlFor="perfil-endereco-cidade">Cidade</Label>
                  <Input
                    id="perfil-endereco-cidade"
                    value={enderecoCidade}
                    onChange={(e) => setEnderecoCidade(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="perfil-endereco-estado">UF</Label>
                  <Input
                    id="perfil-endereco-estado"
                    value={enderecoEstado}
                    maxLength={2}
                    onChange={(e) =>
                      setEnderecoEstado(e.target.value.toUpperCase())
                    }
                  />
                </div>
              </div>
            </div>

            <Separator />

            <Button
              type="submit"
              className="w-full"
              disabled={enviando || !slugValido}
            >
              {enviando && <Loader2 className="mr-2 size-4 animate-spin" />}
              Salvar
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}

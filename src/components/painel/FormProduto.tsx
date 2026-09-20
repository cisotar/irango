"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  schemaProduto,
  ehMensagemDescontoMaiorQuePreco,
} from "@/lib/validacoes/produto";
import { formatarMoeda } from "@/lib/utils/formatarMoeda";
import {
  juntarPrazoLocal,
  separarPrazoLocal,
  previaNaVitrine,
  type TipoDesconto,
} from "@/lib/utils/promocaoPainel";
import type {
  criarProduto as criarProdutoLojista,
  atualizarProduto as atualizarProdutoLojista,
} from "@/lib/actions/produto";
import {
  UploadFotoProduto,
  type EnviarFotoProduto,
} from "@/components/painel/UploadFotoProduto";

/** Um id só para os DOIS inputs do par: D10 é erro de par, não de campo. */
const ID_ERRO_PAR = "produto-erro-preco-desconto";
/** Descrição de fuso compartilhada pelos quatro campos de prazo. */
const ID_FUSO = "produto-desconto-fuso";

export type Categoria = {
  id: string;
  nome: string;
  /** Preferência da categoria (issue toggle-imagens-por-categoria): grid com foto (true) vs. lista textual sem imagem (false) na vitrine. */
  exibir_imagens: boolean;
};

export type ProdutoInicial = {
  id?: string;
  nome?: string;
  descricao?: string | null;
  preco?: number;
  categoria_id?: string | null;
  disponivel?: boolean;
  oculto?: boolean;
  foto_url?: string | null;
  /** Preservada no submit; não é campo editável pelo usuário neste form. */
  ordem?: number;
  // ── Promoção (issue 235) ──────────────────────────────────────────────────
  // Os cinco campos chegam do SERVER COMPONENT, que já converteu os dois
  // prazos de `timestamptz` para a HORA LOCAL da loja (`projetarPromocaoDoPainel`).
  // Nenhuma aritmética de fuso acontece aqui: o que entra é hora local e o que
  // sai é hora local — `comPrazosNoFuso` faz a travessia na Server Action.
  desconto_ativo?: boolean;
  desconto_tipo?: TipoDesconto;
  desconto_valor?: number | null;
  /** `"YYYY-MM-DDTHH:MM"` na hora da loja. */
  desconto_inicio?: string | null;
  /** `"YYYY-MM-DDTHH:MM"` na hora da loja. */
  desconto_fim?: string | null;
};

export type FormProdutoProps = {
  categorias: Categoria[];
  /** Se presente (com `id`), o form opera em modo edição. */
  inicial?: ProdutoInicial;
  /** Usado para o redirect de fallback quando não há `onSucesso`. */
  lojaSlug: string;
  /** Contexto de UI; a propriedade da loja continua derivada no servidor. */
  lojaId: string;
  onSucesso?: () => void;
  /**
   * Actions injetadas. OBRIGATÓRIAS (issue 160): o `ProdutosClient` repassa as
   * do seu `acoes`, que a page do painel preenche com as do lojista (loja
   * derivada do auth) e a via admin com as variantes escopadas por `lojaId`.
   * Sem default — omitir uma quebra o build em vez de gravar na loja errada.
   */
  onCriar: typeof criarProdutoLojista;
  onAtualizar: typeof atualizarProdutoLojista;
  /** Repassada ao `UploadFotoProduto` (a variante admin escopa o path por `lojaId`). */
  onEnviarFoto: EnviarFotoProduto;
  /**
   * Linha de fuso exibida ao lado dos campos de prazo, pronta do servidor
   * (ex.: `America/Sao_Paulo (GMT-3)`). É OBRIGATÓRIA por desenho (§8.1): data
   * e hora separadas não têm onde dizer "isto é no horário da loja", e sem a
   * linha o lojista leria o prazo como se fosse o horário do aparelho dele.
   * Vem pronta porque o deslocamento depende do instante — e o relógio que vale
   * é o do servidor, nunca o do dispositivo.
   */
  fusoLojaRotulo: string;
};

/**
 * Form de produto do painel (issue 043). Client component.
 *
 * Validação no client via `schemaProduto.safeParse` (mesmo schema do servidor) —
 * é só gate de UX; a Server Action revalida e ignora qualquer dado não confiável
 * (loja_id é derivado do dono no servidor, nunca enviado pelo client).
 *
 * `preco` é digitado em reais (string) e convertido para número antes do parse.
 * `ordem` não é editável aqui: preserva o valor do produto em edição, ou 0 ao criar.
 */
export function FormProduto({
  categorias,
  inicial,
  lojaSlug,
  lojaId,
  onSucesso,
  onCriar,
  onAtualizar,
  onEnviarFoto,
  fusoLojaRotulo,
}: FormProdutoProps) {
  const router = useRouter();
  const ehEdicao = inicial?.id != null;

  const [nome, setNome] = useState(inicial?.nome ?? "");
  const [descricao, setDescricao] = useState(inicial?.descricao ?? "");
  const [preco, setPreco] = useState(
    inicial?.preco != null ? String(inicial.preco) : "",
  );
  const [categoriaId, setCategoriaId] = useState(inicial?.categoria_id ?? "");
  const [disponivel, setDisponivel] = useState(inicial?.disponivel ?? true);
  const [oculto, setOculto] = useState(inicial?.oculto ?? false);
  const [fotoUrl, setFotoUrl] = useState<string | null>(
    inicial?.foto_url ?? null,
  );

  // ── Promoção (issue 235) ───────────────────────────────────────────────────
  // RN-07: os cinco campos são estado INDEPENDENTE do switch. Desligar muda
  // `descontoAtivo` e NADA MAIS — tipo, valor e prazo continuam em memória, no
  // payload e na coluna, prontos para quando o lojista ligar de novo.
  const [descontoAtivo, setDescontoAtivo] = useState(
    inicial?.desconto_ativo ?? false,
  );
  const [descontoTipo, setDescontoTipo] = useState<TipoDesconto>(
    inicial?.desconto_tipo ?? null,
  );
  const [descontoValor, setDescontoValor] = useState(
    inicial?.desconto_valor != null ? String(inicial.desconto_valor) : "",
  );
  const prazoInicial = separarPrazoLocal(inicial?.desconto_inicio);
  const prazoFinal = separarPrazoLocal(inicial?.desconto_fim);
  const [comPrazo, setComPrazo] = useState(
    prazoInicial.data !== "" || prazoFinal.data !== "",
  );
  const [inicioData, setInicioData] = useState(prazoInicial.data);
  const [inicioHora, setInicioHora] = useState(prazoInicial.hora);
  const [fimData, setFimData] = useState(prazoFinal.data);
  const [fimHora, setFimHora] = useState(prazoFinal.hora);

  // Superfície do erro de D10 (design §8.3): um bloco re-legível entre Preço e
  // Promoção, NÃO um toast — a mensagem tem dois números e duas saídas, e some
  // em 4 segundos num toast. O toast fica só para falha de rede/servidor.
  const [erroPar, setErroPar] = useState<string | null>(null);
  const blocoErroRef = useRef<HTMLDivElement>(null);

  const [enviando, startEnvio] = useTransition();

  const precoNumero = Number(preco.replace(",", "."));
  const descontoValorNumero =
    descontoValor.trim() === ""
      ? null
      : Number(descontoValor.replace(",", "."));

  const previa = previaNaVitrine({
    preco: precoNumero,
    ativo: descontoAtivo,
    tipo: descontoTipo,
    valor: descontoValorNumero,
  });

  // RN-07: com a promoção desligada os campos continuam VISÍVEIS e
  // preenchidos, só inertes — o lojista vê que a configuração está guardada.
  const camposPromocaoBloqueados = !descontoAtivo || enviando;

  /** Mostra o erro de par no bloco fixo e leva o foco até ele (§8.3). */
  function mostrarErroPar(mensagem: string) {
    setErroPar(mensagem);
    // `requestAnimationFrame` porque o bloco só existe depois do re-render.
    requestAnimationFrame(() => blocoErroRef.current?.focus());
  }

  function montarPayload() {
    return {
      nome: nome.trim(),
      // descricao opcional: string vazia vira undefined.
      ...(descricao.trim() ? { descricao: descricao.trim() } : {}),
      preco: precoNumero,
      categoria_id: categoriaId ? categoriaId : null,
      disponivel,
      oculto,
      foto_url: fotoUrl,
      ordem: inicial?.ordem ?? 0,
      // Os cinco vão SEMPRE juntos e nunca condicionalmente (RN-07): omitir
      // `desconto_ativo` com `false` faria o schema recusar o bloco, e omitir
      // valor/prazo ao desligar apagaria a configuração do lojista.
      desconto_ativo: descontoAtivo,
      desconto_tipo: descontoTipo,
      desconto_valor: descontoValorNumero,
      // Hora LOCAL da loja, do jeito que o schema pede. O checkbox desmarcado
      // envia `null` nos dois — "sem prazo" é ausência, não data inventada.
      desconto_inicio: comPrazo
        ? juntarPrazoLocal(inicioData, inicioHora)
        : null,
      desconto_fim: comPrazo ? juntarPrazoLocal(fimData, fimHora) : null,
    };
  }

  function salvar() {
    const payload = montarPayload();
    setErroPar(null);

    // Gate de UX (servidor revalida o mesmo schema).
    const parsed = schemaProduto.safeParse(payload);
    if (!parsed.success) {
      // A mensagem vem PRONTA do `superRefine` — nenhuma cópia dela mora aqui.
      const d10 = parsed.error.issues.find((i) =>
        ehMensagemDescontoMaiorQuePreco(i.message),
      );
      if (d10) {
        mostrarErroPar(d10.message);
        return;
      }
      toast.error("Confira os dados do produto.");
      return;
    }

    startEnvio(async () => {
      const resultado =
        ehEdicao && inicial?.id
          ? await onAtualizar(inicial.id, parsed.data)
          : await onCriar(parsed.data);

      if (!resultado.ok) {
        // A Server Action promove UMA mensagem de validação (a de D10). Ela
        // merece o bloco re-legível; o resto é falha genérica/rede → toast.
        if (ehMensagemDescontoMaiorQuePreco(resultado.erro)) {
          mostrarErroPar(resultado.erro);
          return;
        }
        toast.error(resultado.erro);
        return;
      }

      toast.success("Produto salvo!");
      if (onSucesso) {
        onSucesso();
      } else {
        router.push(`/painel/produtos`);
        router.refresh();
      }
      // `lojaSlug` mantido na assinatura para futura navegação à vitrine.
      void lojaSlug;
      // `lojaId` é contexto de UI; o upload deriva a loja do auth no servidor.
      void lojaId;
    });
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        salvar();
      }}
    >
      <div className="space-y-1">
        <Label htmlFor="produto-nome">Nome</Label>
        <Input
          id="produto-nome"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder="Ex.: X-Burguer"
          required
          minLength={2}
        />
      </div>

      <UploadFotoProduto
        urlAtual={fotoUrl}
        onUploadConcluido={(url) => setFotoUrl(url || null)}
        disabled={enviando}
        onEnviar={onEnviarFoto}
      />

      <div className="space-y-1">
        <Label htmlFor="produto-descricao">Descrição (opcional)</Label>
        <textarea
          id="produto-descricao"
          value={descricao}
          onChange={(e) => setDescricao(e.target.value)}
          placeholder="Ingredientes, tamanho, etc."
          rows={3}
          className="flex w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="produto-preco">Preço (R$)</Label>
        <Input
          id="produto-preco"
          value={preco}
          onChange={(e) => setPreco(e.target.value)}
          placeholder="0,00"
          inputMode="decimal"
          required
          // D10 é erro de PAR (preço × desconto), não de campo: os DOIS inputs
          // ficam inválidos e apontam para a MESMA descrição.
          aria-invalid={erroPar != null ? true : undefined}
          aria-describedby={erroPar != null ? ID_ERRO_PAR : undefined}
        />
      </div>

      {/* Bloco do erro de D10 — entre Preço e Promoção, os dois campos que a
          mensagem cita. `role="alert"` para quem usa leitor de tela, e
          `tabIndex={-1}` + foco no submit falho para quem não usa: a mensagem
          fica na tela, re-legível, até o lojista resolver. */}
      {erroPar != null && (
        <div
          id={ID_ERRO_PAR}
          ref={blocoErroRef}
          role="alert"
          tabIndex={-1}
          className="space-y-2 rounded-lg border border-destructive/50 bg-destructive/5 p-3 outline-none focus-visible:ring-3 focus-visible:ring-destructive/40"
        >
          {/* A frase vem de `mensagemDescontoMaiorQuePreco`; nenhuma cópia dela
              é escrita neste arquivo. */}
          <p className="text-sm text-destructive">{erroPar}</p>
          {/* As duas saídas que a mensagem nomeia viram botões que PREENCHEM,
              mas NÃO salvam (D10: o sistema não ajusta dinheiro sozinho). */}
          <div className="flex flex-wrap gap-2">
            {Number.isFinite(precoNumero) && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="min-h-[44px]"
                onClick={() => {
                  setDescontoValor(String(precoNumero));
                  setErroPar(null);
                }}
              >
                Reduzir o desconto para {formatarMoeda(precoNumero)}
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-[44px]"
              onClick={() => {
                setDescontoAtivo(false);
                setErroPar(null);
              }}
            >
              Desligar a promoção deste produto
            </Button>
          </div>
        </div>
      )}

      {/* ── Promoção (issue 235) ─────────────────────────────────────────────
          Depois de "Preço" e antes de "Categoria": o desconto é propriedade do
          preço, e o erro de D10 fala dos dois ao mesmo tempo (design §8.1). */}
      <fieldset className="space-y-3 rounded-lg border border-input p-3">
        <legend className="px-1 text-sm font-medium text-foreground">
          Promoção
        </legend>

        <div className="flex min-h-[44px] items-center justify-between gap-3">
          <Label htmlFor="produto-desconto-ativo" className="cursor-pointer">
            Produto em promoção
          </Label>
          <Switch
            id="produto-desconto-ativo"
            checked={descontoAtivo}
            onCheckedChange={(v) => setDescontoAtivo(v === true)}
            disabled={enviando}
          />
        </div>

        {/* 🔴 RN-07: desligar NÃO esconde nem limpa os campos. Se sumissem, o
            lojista concluiria que a configuração foi apagada e redigitaria
            tudo — eles ficam visíveis, `disabled` e esmaecidos. */}
        {!descontoAtivo && (
          <p className="text-xs text-muted-foreground">
            Promoção desligada. Os valores ficam salvos para quando você ligar
            de novo.
          </p>
        )}

        <div className={descontoAtivo ? "space-y-3" : "space-y-3 opacity-60"}>
          <div className="space-y-1">
            <span
              id="produto-desconto-tipo-rotulo"
              className="text-sm font-medium text-foreground"
            >
              Tipo de desconto
            </span>
            {/* RadioGroup, não Select: duas opções sempre visíveis, zero
                cliques de abertura, dois alvos de 44px. */}
            <RadioGroup
              aria-labelledby="produto-desconto-tipo-rotulo"
              value={descontoTipo ?? ""}
              onValueChange={(v) => setDescontoTipo(v as TipoDesconto)}
              className="grid-cols-2 gap-2"
              disabled={camposPromocaoBloqueados}
            >
              <Label
                htmlFor="produto-desconto-percentual"
                className="flex min-h-[44px] cursor-pointer items-center gap-2 rounded-lg border border-input px-3"
              >
                <RadioGroupItem
                  id="produto-desconto-percentual"
                  value="percentual"
                  disabled={camposPromocaoBloqueados}
                />
                <span className="text-sm">Percentual</span>
              </Label>
              <Label
                htmlFor="produto-desconto-fixo"
                className="flex min-h-[44px] cursor-pointer items-center gap-2 rounded-lg border border-input px-3"
              >
                <RadioGroupItem
                  id="produto-desconto-fixo"
                  value="fixo"
                  disabled={camposPromocaoBloqueados}
                />
                <span className="text-sm">Valor em reais</span>
              </Label>
            </RadioGroup>
          </div>

          <div className="space-y-1">
            <Label htmlFor="produto-desconto-valor">
              {descontoTipo === "fixo"
                ? "Valor do desconto (R$)"
                : "Valor do desconto (%)"}
            </Label>
            <Input
              id="produto-desconto-valor"
              value={descontoValor}
              onChange={(e) => setDescontoValor(e.target.value)}
              placeholder={descontoTipo === "fixo" ? "0,00" : "0"}
              inputMode="decimal"
              className="min-h-[44px]"
              disabled={camposPromocaoBloqueados}
              aria-invalid={erroPar != null ? true : undefined}
              aria-describedby={erroPar != null ? ID_ERRO_PAR : undefined}
            />
          </div>

          {/* Prévia via `precoEfetivo` — a MESMA função do servidor, nunca uma
              segunda fórmula. `aria-live` para quem não enxerga o número mudar. */}
          <p
            aria-live="polite"
            className="rounded-lg bg-muted px-3 py-2 text-sm text-foreground"
          >
            {previa != null ? `Na vitrine: ${previa}` : null}
          </p>

          <div className="space-y-1">
            <label className="flex min-h-[44px] cursor-pointer items-center gap-2 text-sm">
              <Checkbox
                checked={comPrazo}
                onCheckedChange={(v) => setComPrazo(v === true)}
                disabled={camposPromocaoBloqueados}
              />
              <span className="text-foreground">
                Definir um prazo (opcional)
              </span>
            </label>

            {comPrazo && (
              <div className="space-y-2 pt-1">
                <div className="space-y-1">
                  <Label htmlFor="produto-desconto-inicio-data">
                    Começa em
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      id="produto-desconto-inicio-data"
                      type="date"
                      value={inicioData}
                      onChange={(e) => setInicioData(e.target.value)}
                      className="min-h-[44px]"
                      disabled={camposPromocaoBloqueados}
                      aria-describedby={ID_FUSO}
                    />
                    <Input
                      type="time"
                      value={inicioHora}
                      onChange={(e) => setInicioHora(e.target.value)}
                      className="min-h-[44px]"
                      disabled={camposPromocaoBloqueados}
                      aria-label="Hora de início da promoção"
                      aria-describedby={ID_FUSO}
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <Label htmlFor="produto-desconto-fim-data">Termina em</Label>
                  <div className="flex gap-2">
                    <Input
                      id="produto-desconto-fim-data"
                      type="date"
                      value={fimData}
                      onChange={(e) => setFimData(e.target.value)}
                      className="min-h-[44px]"
                      disabled={camposPromocaoBloqueados}
                      aria-describedby={ID_FUSO}
                    />
                    <Input
                      type="time"
                      value={fimHora}
                      onChange={(e) => setFimHora(e.target.value)}
                      className="min-h-[44px]"
                      disabled={camposPromocaoBloqueados}
                      aria-label="Hora de término da promoção"
                      aria-describedby={ID_FUSO}
                    />
                  </div>
                </div>

                {/* Linha de fuso OBRIGATÓRIA e adjacente (§8.1): sem ela o
                    lojista leria o prazo como horário do próprio aparelho. */}
                <p id={ID_FUSO} className="text-xs text-muted-foreground">
                  Horários no fuso da loja: {fusoLojaRotulo}
                </p>
              </div>
            )}

            {!comPrazo && (
              <p className="text-xs text-muted-foreground">
                Sem prazo, a promoção vale até você desligar.
              </p>
            )}
          </div>
        </div>
      </fieldset>

      <div className="space-y-1">
        <Label htmlFor="produto-categoria">Categoria (opcional)</Label>
        <select
          id="produto-categoria"
          value={categoriaId}
          onChange={(e) => setCategoriaId(e.target.value)}
          className="flex h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <option value="">Sem categoria</option>
          {categorias.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nome}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-3">
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <Checkbox
            checked={disponivel}
            onCheckedChange={(v) => setDisponivel(v === true)}
          />
          <span className="text-foreground">Disponível na vitrine</span>
        </label>

        <div className="space-y-1">
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox
              checked={oculto}
              onCheckedChange={(v) => setOculto(v === true)}
              aria-describedby="produto-oculto-ajuda"
            />
            <span className="text-foreground">Ocultar da vitrine</span>
          </label>
          <p
            id="produto-oculto-ajuda"
            className="text-xs text-muted-foreground"
          >
            Produto oculto nunca aparece na vitrine. Diferente de esgotado: um
            item disponível mas esgotado ainda aparece, marcado como
            indisponível.
          </p>
        </div>
      </div>

      <Button type="submit" className="w-full" disabled={enviando}>
        {enviando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {ehEdicao ? "Salvar alterações" : "Criar produto"}
      </Button>
    </form>
  );
}

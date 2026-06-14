"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { schemaProduto } from "@/lib/validacoes/produto";
import { criarProduto, atualizarProduto } from "@/lib/actions/produto";

export type Categoria = { id: string; nome: string };

export type ProdutoInicial = {
  id?: string;
  nome?: string;
  descricao?: string | null;
  preco?: number;
  categoria_id?: string | null;
  disponivel?: boolean;
  /** Preservada no submit; não é campo editável pelo usuário neste form. */
  ordem?: number;
};

export type FormProdutoProps = {
  categorias: Categoria[];
  /** Se presente (com `id`), o form opera em modo edição. */
  inicial?: ProdutoInicial;
  /** Usado para o redirect de fallback quando não há `onSucesso`. */
  lojaSlug: string;
  onSucesso?: () => void;
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
  onSucesso,
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

  const [enviando, startEnvio] = useTransition();

  function montarPayload() {
    // Aceita vírgula decimal (UX pt-BR) e converte para número antes do parse.
    const precoNumero = Number(preco.replace(",", "."));
    return {
      nome: nome.trim(),
      // descricao opcional: string vazia vira undefined.
      ...(descricao.trim() ? { descricao: descricao.trim() } : {}),
      preco: precoNumero,
      categoria_id: categoriaId ? categoriaId : null,
      disponivel,
      ordem: inicial?.ordem ?? 0,
    };
  }

  function salvar() {
    const payload = montarPayload();

    // Gate de UX (servidor revalida o mesmo schema).
    const parsed = schemaProduto.safeParse(payload);
    if (!parsed.success) {
      toast.error("Confira os dados do produto.");
      return;
    }

    startEnvio(async () => {
      const resultado =
        ehEdicao && inicial?.id
          ? await atualizarProduto(inicial.id, parsed.data)
          : await criarProduto(parsed.data);

      if (!resultado.ok) {
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
        />
      </div>

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

      <label className="flex cursor-pointer items-center gap-2 text-sm">
        <Checkbox
          checked={disponivel}
          onCheckedChange={(v) => setDisponivel(v === true)}
        />
        <span className="text-foreground">Disponível na vitrine</span>
      </label>

      <Button type="submit" className="w-full" disabled={enviando}>
        {enviando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {ehEdicao ? "Salvar alterações" : "Criar produto"}
      </Button>
    </form>
  );
}

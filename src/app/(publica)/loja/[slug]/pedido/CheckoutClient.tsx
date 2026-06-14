"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { FormEndereco, type EnderecoEntrega } from "@/components/vitrine/FormEndereco";
import { schemaCheckout } from "@/lib/validacoes/checkout";
import { criarPedido } from "@/lib/actions/pedido";
import { formatarMoeda } from "@/lib/utils/formatarMoeda";
import type { ItemCarrinho } from "@/types/dominio";

export type ZonaEntregaCheckout = {
  id: string;
  nome: string;
  taxaEntrega: number;
};
export type FormaPagamentoCheckout = {
  id: string;
  tipo: string;
  instrucoes?: string | null;
};

export type CheckoutClientProps = {
  lojaId: string;
  lojaSlug: string;
  lojaNome: string;
  lojaAberta: boolean;
  zonas: ZonaEntregaCheckout[];
  formasPagamento: FormaPagamentoCheckout[];
};

/** Estado persistido pelo Carrinho (issue 029) — SEM valores monetários. */
type EstadoCheckout = {
  itens: { produtoId: string; quantidade: number }[];
  zonaId: string | null;
  formaPagamentoId: string | null;
  endereco: EnderecoEntrega | null;
  codigoCupom: string | null;
};

const CHAVE_CHECKOUT = "irango:checkout";
const CHAVE_CARRINHO = "irango:carrinho";

/** Lê com segurança (SSR-safe / storage indisponível). */
function lerStorage<T>(chave: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const bruto = window.sessionStorage.getItem(chave);
    return bruto ? (JSON.parse(bruto) as T) : null;
  } catch {
    return null;
  }
}

const ROTULO_PAGAMENTO: Record<string, string> = {
  pix: "Pix",
  dinheiro: "Dinheiro",
  link: "Link de pagamento",
  cartao: "Cartão na entrega",
};

export function CheckoutClient({
  lojaId,
  lojaSlug,
  lojaNome,
  lojaAberta,
  zonas,
  formasPagamento,
}: CheckoutClientProps) {
  const router = useRouter();

  const [estado, setEstado] = useState<EstadoCheckout | null>(null);
  const [itensCarrinho, setItensCarrinho] = useState<ItemCarrinho[]>([]);
  const [montado, setMontado] = useState(false);

  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [observacoes, setObservacoes] = useState("");
  const [enderecoForm, setEnderecoForm] = useState<EnderecoEntrega | null>(null);
  const [formaPagamentoId, setFormaPagamentoId] = useState<string | null>(
    formasPagamento[0]?.id ?? null,
  );
  const [zonaId, setZonaId] = useState<string | null>(zonas[0]?.id ?? null);

  const [enviando, startEnvio] = useTransition();

  // Lê o estado do checkout e os itens do carrinho (com nome/preço para o resumo).
  // sessionStorage só existe no client — leitura pós-hidratação (mount, deps []),
  // padrão hidratação-safe. Os setState rodam uma vez e são batched; não há
  // cascata de renders (regra react-hooks/set-state-in-effect não se aplica aqui).
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const checkout = lerStorage<EstadoCheckout>(CHAVE_CHECKOUT);
    const carrinho = lerStorage<ItemCarrinho[]>(CHAVE_CARRINHO) ?? [];
    setEstado(checkout);
    setItensCarrinho(Array.isArray(carrinho) ? carrinho : []);
    if (checkout?.formaPagamentoId) setFormaPagamentoId(checkout.formaPagamentoId);
    if (checkout?.zonaId) setZonaId(checkout.zonaId);
    if (checkout?.endereco) setEnderecoForm(checkout.endereco);
    setMontado(true);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Itens a exibir: cruza os ids do checkout com nome/preço do carrinho (preview).
  const itensResumo = useMemo(() => {
    const idsCheckout = estado?.itens ?? [];
    return idsCheckout
      .map((i) => {
        const detalhe = itensCarrinho.find((c) => c.produtoId === i.produtoId);
        if (!detalhe) return null;
        return {
          produtoId: i.produtoId,
          nome: detalhe.nome,
          preco: detalhe.preco,
          quantidade: i.quantidade,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
  }, [estado, itensCarrinho]);

  // Preview financeiro (UX). O servidor recalcula tudo do banco (seguranca.md §10).
  const subtotalPreview = useMemo(
    () => itensResumo.reduce((acc, i) => acc + i.preco * i.quantidade, 0),
    [itensResumo],
  );
  const zonaSelecionada = zonas.find((z) => z.id === zonaId) ?? null;
  const fretePreview = zonaSelecionada?.taxaEntrega ?? 0;
  const totalPreview = subtotalPreview + fretePreview;

  // Endereço efetivo: o do carrinho, ou o preenchido aqui no FormEndereco.
  const endereco = enderecoForm;
  const podeEnviar =
    montado &&
    lojaAberta &&
    !enviando &&
    nome.trim().length > 0 &&
    telefone.trim().length > 0 &&
    endereco !== null &&
    formaPagamentoId !== null &&
    itensResumo.length > 0;

  function finalizar() {
    if (endereco == null || formaPagamentoId == null) {
      toast.error("Preencha o endereço e a forma de pagamento.");
      return;
    }

    // Payload do CLIENT — só intenção, NUNCA valores monetários (seguranca.md §10).
    const payload = {
      loja_id: lojaId,
      itens: itensResumo.map((i) => ({
        produto_id: i.produtoId,
        quantidade: i.quantidade,
      })),
      endereco: {
        cep: endereco.cep,
        rua: endereco.rua,
        numero: endereco.numero,
        bairro: endereco.bairro,
        cidade: endereco.cidade,
        uf: endereco.uf,
        ...(endereco.complemento ? { complemento: endereco.complemento } : {}),
      },
      forma_pagamento_id: formaPagamentoId,
      nome: nome.trim(),
      telefone: telefone.trim(),
      ...(estado?.codigoCupom ? { codigo_cupom: estado.codigoCupom } : {}),
      ...(observacoes.trim() ? { observacoes: observacoes.trim() } : {}),
    };

    // Gate de validação no client ANTES da Server Action (o servidor revalida).
    const parsed = schemaCheckout.safeParse(payload);
    if (!parsed.success) {
      toast.error("Confira os dados do pedido.");
      return;
    }

    const formaTipo = formasPagamento.find((f) => f.id === formaPagamentoId)?.tipo;
    if (!formaTipo) {
      toast.error("Selecione uma forma de pagamento válida.");
      return;
    }

    startEnvio(async () => {
      // Mapeia o payload de checkout para o contrato de `criarPedido` (issue 014).
      // `endereco_entrega` não carrega `uf` (schema do servidor); `forma_pagamento`
      // é o TIPO (enum), não o id. Nenhum valor monetário é enviado.
      const resultado = await criarPedido({
        loja_id: parsed.data.loja_id,
        itens: parsed.data.itens,
        endereco_entrega: {
          cep: parsed.data.endereco.cep,
          rua: parsed.data.endereco.rua,
          numero: parsed.data.endereco.numero,
          bairro: parsed.data.endereco.bairro,
          cidade: parsed.data.endereco.cidade,
          ...(parsed.data.endereco.complemento
            ? { complemento: parsed.data.endereco.complemento }
            : {}),
        },
        forma_pagamento: formaTipo,
        nome_cliente: parsed.data.nome,
        telefone_cliente: parsed.data.telefone,
        ...(parsed.data.codigo_cupom
          ? { codigo_cupom: parsed.data.codigo_cupom }
          : {}),
        ...(parsed.data.observacoes
          ? { observacoes: parsed.data.observacoes }
          : {}),
      });

      if ("erro" in resultado) {
        toast.error(resultado.erro);
        return;
      }

      router.push(
        `/loja/${lojaSlug}/confirmacao?pedido=${resultado.pedidoId}&token=${encodeURIComponent(
          resultado.token_acesso,
        )}`,
      );
    });
  }

  if (montado && itensResumo.length === 0) {
    return (
      <main className="mx-auto w-full max-w-2xl px-4 py-16 text-center">
        <h1 className="text-xl font-semibold text-texto">{lojaNome}</h1>
        <p className="mt-4 text-texto-muted">Seu carrinho está vazio.</p>
        <Button
          className="mt-6"
          onClick={() => router.push(`/loja/${lojaSlug}`)}
        >
          Voltar ao cardápio
        </Button>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-6">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold text-texto">Finalizar pedido</h1>
        {!lojaAberta && <Badge variant="destructive">Loja fechada</Badge>}
      </div>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Seu pedido — {lojaNome}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {itensResumo.map((i) => (
            <div key={i.produtoId} className="flex justify-between text-sm">
              <span className="text-texto">
                {i.quantidade}× {i.nome}
              </span>
              <span className="text-texto-muted">
                {formatarMoeda(i.preco * i.quantidade)}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Seus dados</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="nome">Nome</Label>
            <Input
              id="nome"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Seu nome"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="telefone">Telefone</Label>
            <Input
              id="telefone"
              value={telefone}
              onChange={(e) => setTelefone(e.target.value)}
              placeholder="(11) 99999-9999"
              inputMode="tel"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="observacoes">Observações (opcional)</Label>
            <Input
              id="observacoes"
              value={observacoes}
              onChange={(e) => setObservacoes(e.target.value)}
              placeholder="Ex.: sem cebola"
            />
          </div>
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Endereço de entrega</CardTitle>
        </CardHeader>
        <CardContent>
          <FormEndereco onEnderecoChange={setEnderecoForm} />
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Forma de pagamento</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {formasPagamento.length === 0 && (
            <p className="text-sm text-texto-muted">
              Esta loja não configurou formas de pagamento.
            </p>
          )}
          {formasPagamento.map((f) => (
            <label
              key={f.id}
              className="flex cursor-pointer items-center gap-2 text-sm"
            >
              <input
                type="radio"
                name="forma-pagamento"
                value={f.id}
                checked={formaPagamentoId === f.id}
                onChange={() => setFormaPagamentoId(f.id)}
              />
              <span className="text-texto">
                {ROTULO_PAGAMENTO[f.tipo] ?? f.tipo}
              </span>
            </label>
          ))}
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Resumo (estimado)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <div className="flex justify-between">
            <span className="text-texto-muted">Subtotal</span>
            <span className="text-texto">{formatarMoeda(subtotalPreview)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-texto-muted">Entrega</span>
            <span className="text-texto">{formatarMoeda(fretePreview)}</span>
          </div>
          <Separator className="my-2" />
          <div className="flex justify-between font-semibold">
            <span className="text-texto">Total estimado</span>
            <span className="text-texto">{formatarMoeda(totalPreview)}</span>
          </div>
          <p className="pt-2 text-xs text-texto-muted">
            Valores estimados — o total final é calculado pela loja na confirmação.
          </p>
        </CardContent>
      </Card>

      <Button
        className="w-full"
        size="lg"
        disabled={!podeEnviar}
        onClick={finalizar}
      >
        {enviando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {lojaAberta ? "Confirmar pedido" : "Loja fechada"}
      </Button>
    </main>
  );
}

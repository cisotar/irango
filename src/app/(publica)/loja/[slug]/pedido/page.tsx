import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import {
  listarFormasPagamento,
  listarZonasComTaxas,
} from "@/lib/supabase/queries/entregaPagamento";
import { buscarLojaPorSlug, type LojaPublica } from "@/lib/supabase/queries/lojas";
import { lojaAberta, type Horarios } from "@/lib/utils/lojaAberta";
import { CheckoutWizard } from "@/components/vitrine/checkout/CheckoutWizard";
import type {
  FormaPagamentoWizard,
  TipoPagamento,
} from "@/components/vitrine/checkout/estado";

type PageProps = { params: Promise<{ slug: string }> };

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const db = await createClient();
  const loja = await buscarLojaPorSlug(db, slug);
  if (!loja || !loja.nome) {
    return { title: "Loja não encontrada — iRango" };
  }
  return { title: `Finalizar pedido — ${loja.nome} — iRango` };
}

/** Horários do JSONB → shape de lojaAberta (fail-safe se ausente). */
function resolverHorarios(horarios: LojaPublica["horarios"]): Horarios {
  return (horarios ?? {}) as Horarios;
}

const TIPOS_PAGAMENTO: readonly TipoPagamento[] = [
  "pix",
  "dinheiro",
  "link",
  "cartao",
];

function ehTipoPagamento(valor: string): valor is TipoPagamento {
  return (TIPOS_PAGAMENTO as readonly string[]).includes(valor);
}

/** Lê chave/QR do config (jsonb) só para Pix — nunca enviado pelo cliente. */
function extrairConfigPix(config: unknown): {
  chavePix?: string | null;
  pixQrUrl?: string | null;
} {
  if (config == null || typeof config !== "object") return {};
  const c = config as Record<string, unknown>;
  return {
    chavePix: typeof c.chave === "string" ? c.chave : null,
    pixQrUrl: typeof c.pix_qr_url === "string" ? c.pix_qr_url : null,
  };
}

export default async function CheckoutPage({ params }: PageProps) {
  const { slug } = await params;
  const db = await createClient();

  const loja = await buscarLojaPorSlug(db, slug);
  if (!loja || !loja.id || !loja.nome) notFound();

  const lojaId = loja.id;

  const [zonasComTaxa, formas] = await Promise.all([
    listarZonasComTaxas(db, lojaId),
    listarFormasPagamento(db, lojaId),
  ]);

  // Preview de "loja aberta" — o servidor (criarPedido/RN-C6) é a verdade final.
  const aberta = lojaAberta(
    resolverHorarios(loja.horarios),
    new Date(),
    loja.timezone ?? "America/Sao_Paulo",
  ).aberta;

  // RN-C4 (edge): loja aceita entrega se tem alguma zona ativa com taxa OU
  // taxa_entrega_fora_zona configurada. Sem nenhuma → só retirada.
  const temZonaAtiva = zonasComTaxa.some((z) => z.ativo && z.taxa !== null);
  const aceitaEntrega =
    temZonaAtiva || loja.taxa_entrega_fora_zona != null;

  // Formas de pagamento ativas, hidratadas (Pix carrega chave + QR do banco).
  const formasPagamento: FormaPagamentoWizard[] = formas
    .filter((f) => ehTipoPagamento(f.tipo))
    .map((f) => {
      const tipo = f.tipo as TipoPagamento;
      const base: FormaPagamentoWizard = { id: f.id, tipo };
      return tipo === "pix" ? { ...base, ...extrairConfigPix(f.config) } : base;
    });

  return (
    <CheckoutWizard
      lojaId={lojaId}
      lojaSlug={slug}
      lojaNome={loja.nome}
      lojaAberta={aberta}
      aceitaEntrega={aceitaEntrega}
      formasPagamento={formasPagamento}
    />
  );
}

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
import { formatarEnderecoLoja } from "@/lib/utils/enderecoLoja";
import {
  entregaDisponivel,
  retiradaDisponivel,
} from "@/lib/utils/modalidadesEntrega";
import {
  buscarPerfilCliente,
  listarEnderecosCliente,
} from "@/lib/supabase/queries/clientes";
import type {
  EnderecoClienteCheckout,
  PerfilClienteCheckout,
} from "@/components/vitrine/checkout/clienteCheckout";
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

type ClienteCheckout = {
  /** Sem sessão de cliente ⇒ "Entrar" junto do cupom. */
  mostrarEntrar: boolean;
  /** Logado com e-mail confirmado e sem perfil ⇒ "Complete seu perfil". */
  mostrarCompletarPerfil: boolean;
  perfil: PerfilClienteCheckout | null;
  enderecos: EnderecoClienteCheckout[];
};

/**
 * (343) Sessão de cliente OPCIONAL: client da sessão + RLS do Marco B. Só
 * pré-preenchimento (RN-C18) — o `cliente_id` do pedido é resolvido de novo em
 * `criarPedido`. Qualquer falha ⇒ checkout de convidado, idêntico a hoje.
 */
async function lerClienteCheckout(
  db: Awaited<ReturnType<typeof createClient>>,
): Promise<ClienteCheckout> {
  const convidado: ClienteCheckout = {
    mostrarEntrar: true,
    mostrarCompletarPerfil: false,
    perfil: null,
    enderecos: [],
  };
  try {
    const { data, error } = await db.auth.getUser();
    const user = data?.user;
    if (error || !user || !user.email_confirmed_at) return convidado;
    const [perfil, enderecos] = await Promise.all([
      buscarPerfilCliente(db, user.id),
      listarEnderecosCliente(db, user.id),
    ]);
    if (!perfil) return { ...convidado, mostrarEntrar: false, mostrarCompletarPerfil: true };
    return {
      mostrarEntrar: false,
      mostrarCompletarPerfil: false,
      perfil: { nome: perfil.nome, telefone: perfil.telefone },
      enderecos: enderecos.map((e) => ({
        id: e.id,
        rotulo: e.rotulo,
        padrao: e.padrao,
        endereco: {
          cep: e.cep,
          rua: e.rua,
          numero: e.numero,
          bairro: e.bairro,
          cidade: e.cidade,
          uf: e.uf,
          ...(e.complemento ? { complemento: e.complemento } : {}),
        },
      })),
    };
  } catch (e) {
    console.error("[checkout] cliente", e instanceof Error ? e.name : "erro");
    return convidado;
  }
}

export default async function CheckoutPage({ params }: PageProps) {
  const { slug } = await params;
  const db = await createClient();

  const loja = await buscarLojaPorSlug(db, slug);
  if (!loja || !loja.id || !loja.nome) notFound();

  const lojaId = loja.id;

  const [zonasComTaxa, formas, cliente] = await Promise.all([
    listarZonasComTaxas(db, lojaId),
    listarFormasPagamento(db, lojaId),
    lerClienteCheckout(db),
  ]);

  // Preview de "loja aberta" — o servidor (criarPedido/RN-C6) é a verdade final.
  const aberta = lojaAberta(
    resolverHorarios(loja.horarios),
    new Date(),
    loja.timezone ?? "America/Sao_Paulo",
  ).aberta;

  // Modalidades (spec modalidades-entrega-loja, RN-C4, D4) — preview de UX pela
  // MESMA regra do aviso do painel; `criarPedido` relê a loja e recusa a
  // modalidade desligada.
  const aceitaEntrega = entregaDisponivel(loja, zonasComTaxa);
  const aceitaRetirada = retiradaDisponivel(loja);

  // Formas de pagamento ativas, hidratadas (Pix carrega chave + QR do banco).
  const formasPagamento: FormaPagamentoWizard[] = formas
    .filter((f) => ehTipoPagamento(f.tipo))
    .map((f) => {
      const tipo = f.tipo as TipoPagamento;
      const base: FormaPagamentoWizard = { id: f.id, tipo };
      return tipo === "pix" ? { ...base, ...extrairConfigPix(f.config) } : base;
    });

  // [287] RN-A5 aposentada: o checkout não pré-abre mais aba do WhatsApp, e
  // `whatsapp_envio_automatico` deixa de ser lido aqui. O aviso de envio passou
  // a viver na página de confirmação, que lê o toggle no próprio SSR.

  // [180-B] Número público de WhatsApp da loja (mesmo campo já exibido no
  // header da vitrine). Independente de `whatsapp_envio_automatico`: o modal de
  // frete indisponível só precisa saber se EXISTE canal para combinar a
  // entrega; sem número, ele oferece retirada.
  const whatsappLoja = (loja.whatsapp ?? "").trim() || null;

  // [197] Endereço curto da loja (RN-R1), derivado no SSR a partir de
  // `vitrine_lojas` (dado já público). Exibição pura: o cliente só decide
  // MOSTRAR ou não conforme o rádio — nenhuma chamada de rede no toggle e
  // nenhum efeito sobre frete, cupom ou total. `null` ⇒ fallback (RN-R5).
  const enderecoLoja = formatarEnderecoLoja(loja);

  return (
    <CheckoutWizard
      lojaId={lojaId}
      lojaSlug={slug}
      lojaNome={loja.nome}
      lojaAberta={aberta}
      aceitaEntrega={aceitaEntrega}
      aceitaRetirada={aceitaRetirada}
      formasPagamento={formasPagamento}
      whatsappLoja={whatsappLoja}
      enderecoLoja={enderecoLoja}
      perfilCliente={cliente.perfil}
      enderecosCliente={cliente.enderecos.length > 0 ? cliente.enderecos : undefined}
      mostrarEntrar={cliente.mostrarEntrar}
      mostrarCompletarPerfil={cliente.mostrarCompletarPerfil}
    />
  );
}

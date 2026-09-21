import "server-only";

import { notFound } from "next/navigation";

import { validarLojaIdAdmin } from "@/lib/actions/admin-loja";
import { verificarAdminSaaS } from "@/lib/auth/admin";
import { createServiceClient } from "@/lib/supabase/service";
import {
  buscarCardapiosComProdutos,
  buscarCardapiosDoPainel,
  type CardapioDaLoja,
  type CardapioDoPainel,
  type ProdutoVinculado,
} from "@/lib/supabase/queries/cardapios";
import {
  buscarLojaAdminPorId,
  type LojaCompleta,
} from "@/lib/supabase/queries/lojas";

/**
 * [Auditoria 260/261] Os cardápios da LOJA-ALVO para o hub admin.
 *
 * Existe porque o `FormProduto` decide por este dado se mostra "Está em: …" ou
 * o alerta "este produto não está em nenhum cardápio". Sem ele o hub admin
 * afirmava o alerta para um produto que está em dois cardápios — e convidava um
 * operador com BYPASSRLS a convertê-lo ao menu sem necessidade.
 *
 * Este loader é leitura pura. As Server Actions de lote e de cardápio do hub
 * admin vivem em `actions/admin-cardapios.ts` (issue 269) e a prop `lote` do
 * `ProdutosClient` é injetada em `CardapioAdminClient`.
 *
 * Mesma ordem fail-closed de `carga.ts` e `carga-opcionais.ts`:
 *  1. `validarLojaIdAdmin(lojaId)` — não-UUID → `notFound()` ANTES de qualquer
 *     leitura (nenhum service client, nenhuma query);
 *  2. `verificarAdminSaaS()` ANTES de `createServiceClient()` — a falha PROPAGA;
 *  3. query escopada pela `lojaId` VALIDADA. Sob `service_role` (BYPASSRLS) o
 *     isolamento cross-tenant é o `.eq("loja_id")` que `buscarCardapiosComProdutos`
 *     aplica explicitamente — não a RLS.
 */
export async function carregarCardapiosAdmin(lojaId: string): Promise<{
  cardapios: CardapioDaLoja[];
  cardapiosPorProduto: Map<string, CardapioDaLoja[]>;
}> {
  const validacao = validarLojaIdAdmin(lojaId);
  if (!validacao.ok) {
    notFound();
  }
  const idValidado = validacao.lojaId;

  // Prova de admin ANTES de elevar a service_role; a falha PROPAGA.
  await verificarAdminSaaS();

  const svc = createServiceClient();

  return buscarCardapiosComProdutos(svc, idValidado);
}

/**
 * [269 · fase 5] A LISTA de cardápios da loja-alvo para
 * `/admin/assinantes/[lojaId]/cardapios` — o gêmeo admin de
 * `/painel/cardapios`.
 *
 * Devolve a loja junto porque o badge, a frase de vigência e a contagem de
 * "produtos escondidos" são derivados no SERVIDOR com o relógio do servidor e o
 * fuso da LOJA-ALVO: o admin edita em nome do lojista e não pode ver "Aberto
 * agora" por outro relógio.
 *
 * Mesma ordem fail-closed de `carga.ts` (ver `carregarCardapiosAdmin` acima):
 * `lojaId` não-UUID → `notFound()` ANTES de qualquer leitura; prova de admin
 * antes de elevar; loja-alvo inexistente → `notFound()`. Sob `service_role`
 * (BYPASSRLS) o isolamento é o `.eq("loja_id")` explícito das queries.
 */
export async function carregarCardapiosDoPainelAdmin(lojaId: string): Promise<{
  loja: LojaCompleta;
  cardapios: CardapioDoPainel[];
  produtos: ProdutoVinculado[];
  cardapiosPorProduto: Map<string, CardapioDaLoja[]>;
}> {
  const validacao = validarLojaIdAdmin(lojaId);
  if (!validacao.ok) {
    notFound();
  }
  const idValidado = validacao.lojaId;

  // Prova de admin ANTES de elevar a service_role; a falha PROPAGA.
  await verificarAdminSaaS();

  const svc = createServiceClient();

  const loja = await buscarLojaAdminPorId(svc, idValidado);
  if (loja == null) {
    notFound();
  }

  const { cardapios, produtos, cardapiosPorProduto } =
    await buscarCardapiosDoPainel(svc, idValidado);

  return { loja, cardapios, produtos, cardapiosPorProduto };
}

import "server-only";

import { notFound } from "next/navigation";

import { validarLojaIdAdmin } from "@/lib/actions/admin-loja";
import { verificarAdminSaaS } from "@/lib/auth/admin";
import { createServiceClient } from "@/lib/supabase/service";
import {
  buscarCardapiosComProdutos,
  type CardapioDaLoja,
} from "@/lib/supabase/queries/cardapios";

/**
 * [Auditoria 260/261] Os cardápios da LOJA-ALVO para o hub admin.
 *
 * Existe porque o `FormProduto` decide por este dado se mostra "Está em: …" ou
 * o alerta "este produto não está em nenhum cardápio". Sem ele o hub admin
 * afirmava o alerta para um produto que está em dois cardápios — e convidava um
 * operador com BYPASSRLS a convertê-lo ao menu sem necessidade.
 *
 * O hub admin NÃO ganha ação de cardápio com isto: é leitura pura. As Server
 * Actions de lote continuam só no painel do lojista (derivam a loja de
 * `auth.uid()`), e a prop `lote` do `ProdutosClient` segue ausente aqui.
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

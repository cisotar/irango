import "server-only";

import { notFound } from "next/navigation";

import { validarLojaIdAdmin } from "@/lib/actions/admin-loja";
import { verificarAdminSaaS } from "@/lib/auth/admin";
import { createServiceClient } from "@/lib/supabase/service";
import {
  buscarCardapioPorId,
  buscarCardapiosComProdutos,
  type CardapioDaLoja,
} from "@/lib/supabase/queries/cardapios";
import type {
  CardapioVigencia,
  VinculoVigencia,
} from "@/lib/utils/vigenciaCardapio";
import { buscarProdutosDoLojista, type Produto } from "@/lib/supabase/queries/produtos";
import { buscarCategorias, type Categoria } from "@/lib/supabase/queries/categorias";
import {
  buscarLojaAdminPorId,
  type LojaCompleta,
} from "@/lib/supabase/queries/lojas";

/**
 * [269 · fase 5] O DETALHE de um cardápio da loja-alvo, para
 * `/admin/assinantes/[lojaId]/cardapios/[cardapioId]` — o gêmeo admin de
 * `/painel/cardapios/[cardapioId]`.
 *
 * Mesma ordem fail-closed de `carga.ts`:
 *  1. `validarLojaIdAdmin(lojaId)` — não-UUID → `notFound()` ANTES de qualquer
 *     leitura (nenhum service client, nenhuma query);
 *  2. `verificarAdminSaaS()` ANTES de `createServiceClient()` — a falha PROPAGA;
 *  3. loja-alvo inexistente → `notFound()`;
 *  4. `buscarCardapioPorId(svc, lojaId, cardapioId)` → `null` → `notFound()`.
 *
 * SEM ORÁCULO DE EXISTÊNCIA (`seguranca.md` §14): id inexistente e id de OUTRA
 * loja produzem a MESMA resposta, porque o `.eq("loja_id")` explícito da query
 * (sob `service_role` a RLS não filtra nada) descarta o alheio antes de a rota
 * saber que ele existe. As duas passam pelo mesmo `notFound()`.
 */
export async function carregarCardapioDetalheAdmin(
  lojaId: string,
  cardapioId: string,
): Promise<{
  loja: LojaCompleta;
  cardapio: CardapioVigencia;
  produtos: Produto[];
  categorias: Categoria[];
  vinculosPorProduto: Map<string, VinculoVigencia<CardapioDaLoja>[]>;
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

  const cardapio = await buscarCardapioPorId(svc, idValidado, cardapioId);
  if (cardapio == null) {
    notFound();
  }

  // Três leituras em paralelo, todas escopadas pela MESMA `lojaId` validada —
  // o mesmo perfil da rota do lojista, sem nenhuma query por produto.
  const [produtos, categorias, { vinculosPorProduto }] = await Promise.all([
    buscarProdutosDoLojista(svc, idValidado),
    buscarCategorias(svc, idValidado),
    buscarCardapiosComProdutos(svc, idValidado),
  ]);

  return { loja, cardapio, produtos, categorias, vinculosPorProduto };
}

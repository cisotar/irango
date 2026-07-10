import "server-only";

import { notFound } from "next/navigation";

import { validarLojaIdAdmin } from "@/lib/actions/admin-loja";
import { verificarAdminSaaS } from "@/lib/auth/admin";
import { createServiceClient } from "@/lib/supabase/service";
import { buscarLojaAdminPorId, type LojaCompleta } from "@/lib/supabase/queries/lojas";
import { buscarCategorias, type Categoria } from "@/lib/supabase/queries/categorias";
import { buscarProdutosDoLojista, type Produto } from "@/lib/supabase/queries/produtos";
import {
  listarZonasComTaxas,
  listarFormasPagamento,
  type ZonaVitrine,
  type FormaPagamento,
} from "@/lib/supabase/queries/entregaPagamento";
import {
  buscarPlanoAtivo,
  listarPlanosAtivos,
  type Plano,
} from "@/lib/supabase/queries/planos";
import {
  listarFaturasDaLojaAdmin,
  type FaturaAssinatura,
} from "@/lib/supabase/queries/pagamentosAssinatura";

/**
 * Agregado de leitura do painel admin SaaS para UMA loja-alvo (issue 096,
 * specs/admin-onboarding-assistido.md). Todos os dados já escopados por `lojaId`.
 */
export type LojaAdminAgregado = {
  loja: LojaCompleta;
  categorias: Categoria[];
  produtos: Produto[];
  zonas: ZonaVitrine[];
  formasPagamento: FormaPagamento[];
};

/**
 * Loader server-only (NÃO `'use server'`) do painel admin SaaS. Carrega os dados
 * da loja-alvo via service_role, ESCOPADOS por `lojaId`. Chamado por Server
 * Component admin.
 *
 * Ordem inegociável (fail-closed):
 *  1. `validarLojaIdAdmin(lojaId)` (083, z.guid()) — não-UUID → `notFound()` ANTES
 *     de qualquer leitura (nenhum service client, nenhuma query).
 *  2. `verificarAdminSaaS()` ANTES de `createServiceClient()` — a falha PROPAGA
 *     (RN-1, D-4): nenhuma elevação a service_role nem query acontece.
 *  3. `buscarLojaAdminPorId(svc, lojaId)` (TABELA base, enxerga loja inativa em
 *     onboarding); `null` → `notFound()`.
 *  4. Demais queries `(svc, lojaId)`, todas escopadas pela mesma `lojaId` validada.
 */
export async function carregarLojaAdmin(lojaId: string): Promise<LojaAdminAgregado> {
  const validacao = validarLojaIdAdmin(lojaId);
  if (!validacao.ok) {
    notFound();
  }
  const idValidado = validacao.lojaId;

  // Prova de admin ANTES de elevar a service_role; a falha PROPAGA (nenhuma leitura).
  await verificarAdminSaaS();

  const svc = createServiceClient();

  const loja = await buscarLojaAdminPorId(svc, idValidado);
  if (!loja) {
    notFound();
  }

  const [categorias, produtos, zonas, formasPagamento] = await Promise.all([
    buscarCategorias(svc, idValidado),
    buscarProdutosDoLojista(svc, idValidado),
    listarZonasComTaxas(svc, idValidado),
    listarFormasPagamento(svc, idValidado),
  ]);

  return { loja, categorias, produtos, zonas, formasPagamento };
}

/**
 * Loader server-only ENXUTO do painel admin SaaS: carrega SÓ a linha `lojas`
 * (via `buscarLojaAdminPorId`), sem categorias/produtos/zonas/formas. Serve as
 * sub-rotas Perfil/Horários/Tema/Assinatura (issues 152/153), que precisam dos
 * campos completos da loja (perfil, `horarios`, `tema`, `timezone`) — mas NÃO do
 * catálogo/entrega/pagamento que `carregarLojaAdmin` traz (evita over-fetch).
 *
 * MESMA ordem inegociável (fail-closed) de `carregarLojaAdmin`:
 *  1. `validarLojaIdAdmin(lojaId)` (083, z.guid()) — não-UUID → `notFound()`
 *     ANTES de qualquer leitura (nenhum service client, nenhuma query).
 *  2. `verificarAdminSaaS()` FORA do try, ANTES de `createServiceClient()` — a
 *     falha PROPAGA (RN-1, D-4): nenhuma elevação a service_role nem leitura.
 *  3. `buscarLojaAdminPorId(svc, id)` (TABELA base, enxerga loja inativa em
 *     onboarding); `null` → `notFound()`.
 *
 * A elevação a service_role fica AQUI (nunca em `page.tsx`): a decisão (b) do
 * plano (issue 150) mantém o `svc` dentro dos loaders — a página recebe só o
 * dado materializado. Ver `enforcement-escopo-admin.test.ts`.
 */
export async function carregarLojaAdminBase(lojaId: string): Promise<LojaCompleta> {
  const validacao = validarLojaIdAdmin(lojaId);
  if (!validacao.ok) {
    notFound();
  }
  const idValidado = validacao.lojaId;

  // Prova de admin ANTES de elevar a service_role; a falha PROPAGA (nenhuma leitura).
  await verificarAdminSaaS();

  const svc = createServiceClient();

  const loja = await buscarLojaAdminPorId(svc, idValidado);
  if (!loja) {
    notFound();
  }

  return loja;
}

/**
 * Loader server-only de SEÇÃO do painel admin SaaS: carrega SÓ as zonas de
 * entrega (com taxas/bairros) da loja-alvo, para a sub-rota de Entregas (issue
 * 152). Não faz over-fetch de loja/catálogo/formas.
 *
 * MESMA ordem inegociável (fail-closed) de `carregarLojaAdminBase`:
 *  1. `validarLojaIdAdmin(lojaId)` (083, z.guid()) — não-UUID → `notFound()`
 *     ANTES de qualquer leitura.
 *  2. `verificarAdminSaaS()` FORA do try, ANTES de `createServiceClient()` — a
 *     falha PROPAGA (RN-1, D-4): nenhuma elevação a service_role nem leitura.
 *  3. `listarZonasComTaxas(svc, id)` escopada pela `lojaId` validada.
 *
 * A elevação a service_role fica AQUI, nunca em `page.tsx` (decisão b, issue
 * 150) — a página recebe só o dado materializado. Ver `enforcement-escopo-admin.test.ts`.
 */
export async function carregarZonasAdmin(lojaId: string): Promise<ZonaVitrine[]> {
  const validacao = validarLojaIdAdmin(lojaId);
  if (!validacao.ok) {
    notFound();
  }
  const idValidado = validacao.lojaId;

  // Prova de admin ANTES de elevar a service_role; a falha PROPAGA (nenhuma leitura).
  await verificarAdminSaaS();

  const svc = createServiceClient();

  return listarZonasComTaxas(svc, idValidado);
}

/**
 * Loader server-only de SEÇÃO do painel admin SaaS: carrega SÓ as formas de
 * pagamento da loja-alvo, para a sub-rota de Pagamentos (issue 152). Não faz
 * over-fetch de loja/catálogo/zonas.
 *
 * MESMA ordem inegociável (fail-closed) de `carregarLojaAdminBase`:
 *  1. `validarLojaIdAdmin(lojaId)` (083, z.guid()) — não-UUID → `notFound()`
 *     ANTES de qualquer leitura.
 *  2. `verificarAdminSaaS()` FORA do try, ANTES de `createServiceClient()` — a
 *     falha PROPAGA (RN-1, D-4): nenhuma elevação a service_role nem leitura.
 *  3. `listarFormasPagamento(svc, id)` escopada pela `lojaId` validada.
 */
export async function carregarFormasPagamentoAdmin(
  lojaId: string,
): Promise<FormaPagamento[]> {
  const validacao = validarLojaIdAdmin(lojaId);
  if (!validacao.ok) {
    notFound();
  }
  const idValidado = validacao.lojaId;

  // Prova de admin ANTES de elevar a service_role; a falha PROPAGA (nenhuma leitura).
  await verificarAdminSaaS();

  const svc = createServiceClient();

  return listarFormasPagamento(svc, idValidado);
}

/**
 * Agregado de leitura da sub-rota admin de Assinatura (issue 153). Reúne, sob UM
 * único `svc` admin-provado, tudo que a central de assinatura da loja-alvo
 * precisa: a linha `lojas` (status/plano/flags), o plano atual, o catálogo de
 * planos ativos e as faturas. A page NUNCA eleva a service_role inline — a
 * elevação vive AQUI (decisão b, issue 150; ver `enforcement-escopo-admin.test.ts`).
 *
 * `carregarLojaAdminBase` (150) devolve só a `LojaCompleta` e NÃO expõe o `svc`
 * que criou, logo não alimentaria `buscarPlanoAtivo`/`listarPlanosAtivos`/
 * `listarFaturasDaLojaAdmin`; um loader agregado evita criar um SEGUNDO `svc`
 * inline (proibido) ou duplicar a prova de admin por query.
 *
 * MESMA ordem inegociável (fail-closed) dos demais loaders:
 *  1. `validarLojaIdAdmin(lojaId)` (083, z.guid()) — não-UUID → `notFound()`
 *     ANTES de qualquer leitura (nenhum service client, nenhuma query).
 *  2. `verificarAdminSaaS()` FORA do try, ANTES de `createServiceClient()` — a
 *     falha PROPAGA (RN-1, D-4): nenhuma elevação a service_role nem leitura.
 *  3. `buscarLojaAdminPorId(svc, id)` (TABELA base, enxerga loja inativa em
 *     onboarding); `null` → `notFound()`.
 *  4. `planoAtual` só é buscado se `loja.plano_id != null` (loja nunca-assinou →
 *     `null`); catálogo e faturas em paralelo, todos escopados por `lojaId`.
 *
 * Valor é AUTORITATIVO do banco: `planos.preco` (RN-1) e `pagamentos_assinatura.valor`
 * (webhook 077); a UI apenas formata, nunca recalcula (seguranca.md §10).
 */
export type AssinaturaAdminAgregado = {
  loja: LojaCompleta;
  planoAtual: Plano | null;
  planos: Plano[];
  faturas: FaturaAssinatura[];
};

export async function carregarAssinaturaAdmin(
  lojaId: string,
): Promise<AssinaturaAdminAgregado> {
  const validacao = validarLojaIdAdmin(lojaId);
  if (!validacao.ok) {
    notFound();
  }
  const idValidado = validacao.lojaId;

  // Prova de admin ANTES de elevar a service_role; a falha PROPAGA (nenhuma leitura).
  await verificarAdminSaaS();

  const svc = createServiceClient();

  const loja = await buscarLojaAdminPorId(svc, idValidado);
  if (!loja) {
    notFound();
  }

  const [planoAtual, planos, faturas] = await Promise.all([
    loja.plano_id ? buscarPlanoAtivo(svc, loja.plano_id) : Promise.resolve(null),
    listarPlanosAtivos(svc),
    listarFaturasDaLojaAdmin(svc, idValidado),
  ]);

  return { loja, planoAtual, planos, faturas };
}

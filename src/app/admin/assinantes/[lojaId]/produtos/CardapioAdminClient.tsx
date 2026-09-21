"use client";

import { useCallback } from "react";

import { ProdutosClient } from "@/app/(painel)/painel/(bloqueavel)/produtos/ProdutosClient";
import type { Categoria } from "@/components/painel/FormProduto";
import type {
  Produto,
  OpcionaisPorCategoria,
} from "@/lib/supabase/queries/produtos";
import type { ProdutosClientProps } from "@/app/(painel)/painel/(bloqueavel)/produtos/ProdutosClient";
import { schemaReordenacaoCategorias } from "@/lib/validacoes/produto";
import {
  criarCategoriaAdmin,
  atualizarCategoriaAdmin,
  removerCategoriaAdmin,
  alternarExibirImagensAdmin,
  reordenarCategoriasAdmin,
} from "@/app/admin/assinantes/actions/admin-categorias";
import {
  criarProdutoAdmin,
  atualizarProdutoAdmin,
  removerProdutoAdmin,
  alternarDisponibilidadeAdmin,
  alternarOcultoAdmin,
} from "@/app/admin/assinantes/actions/admin-produtos";
import { enviarFotoProdutoAdmin } from "@/app/admin/assinantes/actions/admin-upload";
import {
  criarCategoriaOpcionalAdmin,
  atualizarCategoriaOpcionalAdmin,
  removerCategoriaOpcionalAdmin,
  criarOpcionalAdmin,
  atualizarOpcionalAdmin,
  alternarOpcionalAtivoAdmin,
  removerOpcionalAdmin,
  salvarAssociacaoOpcionaisAdmin,
  reordenarOpcionaisDaCategoriaAdmin,
  reordenarItensDoGrupoOpcionalAdmin,
} from "@/app/admin/assinantes/actions/admin-opcionais";

/**
 * Wrapper client da aba Cardápio do hub admin (issue 100). Reusa o
 * `ProdutosClient` parametrizado do painel (097) — que já embute
 * `GerenciarCategorias`, `FormProduto` e `UploadFotoProduto` — e INJETA as
 * Server Actions admin (088/089/090) com o `lojaId` da URL fixado via closures.
 *
 * Segurança: `lojaId` aqui é só para montar a chamada. A autoridade (validação
 * UUID, escopo cross-loja, recálculo de preço, path de upload) é das actions
 * admin no servidor. As actions admin têm assinatura `(lojaId, ...)`; os wrappers
 * abaixo adaptam para a forma sem `lojaId` que o `ProdutosClient` espera (mesmas
 * assinaturas das actions do lojista).
 */
export function CardapioAdminClient({
  lojaSlug,
  lojaId,
  produtos,
  categorias,
  opcionaisPorCategoria,
  cardapiosPorProduto,
  categoriasOpcional,
  opcionais,
  associacoes,
  promocoes,
  fusoLojaRotulo,
}: {
  lojaSlug: string;
  lojaId: string;
  produtos: Produto[];
  categorias: Categoria[];
  opcionaisPorCategoria: OpcionaisPorCategoria;
} & Pick<
  ProdutosClientProps,
  // [Auditoria 260/261] `cardapiosPorProduto` é OBRIGATÓRIA e vem do Server
  // Component admin (`carga-cardapios.ts`). O hub admin continua SEM a prop
  // `lote` — nenhuma ação de cardápio aqui, só a leitura que impede o
  // `FormProduto` de afirmar "não está em nenhum cardápio" sobre quem está.
  | "cardapiosPorProduto"
  // [235] `promocoes`/`fusoLojaRotulo` são projeção do SERVER COMPONENT admin
  // (com o fuso da loja-alvo) — o wrapper só repassa, sem derivar nada.
  | "categoriasOpcional"
  | "opcionais"
  | "associacoes"
  | "promocoes"
  | "fusoLojaRotulo"
>) {
  // Foto: o `UploadFotoProduto` monta o FormData só com o arquivo (CAMPO_ARQUIVO).
  // A action admin lê `loja_id` do FormData; injetamos o `lojaId` da URL aqui.
  const enviarFotoProduto = useCallback(
    async (formData: FormData) => {
      formData.set("loja_id", lojaId);
      return enviarFotoProdutoAdmin(formData);
    },
    [lojaId],
  );

  return (
    <ProdutosClient
      lojaSlug={lojaSlug}
      lojaId={lojaId}
      produtos={produtos}
      categorias={categorias}
      promocoes={promocoes}
      fusoLojaRotulo={fusoLojaRotulo}
      // Opcionais reais da loja-alvo (loader 132). Guard 122-129: habilitar
      // `categoriasOpcional` reais EXIGE injetar `salvarAssociacaoOpcionais`
      // admin no `acoes` (abaixo) na MESMA mudança — a prop é OBRIGATÓRIA
      // (issue 160): omiti-la quebra a compilação, não cai mais em fallback.
      opcionaisPorCategoria={opcionaisPorCategoria}
      cardapiosPorProduto={cardapiosPorProduto}
      categoriasOpcional={categoriasOpcional}
      // [217] A biblioteca de itens e as linhas de associação alimentam o
      // cartão dentro do modal. Nenhuma query nova no admin: o agregado
      // `carregarOpcionaisAdmin` (132) já devolvia as duas — a page só passou a
      // desestruturá-las.
      opcionais={opcionais}
      associacoes={associacoes}
      acoes={{
        criarCategoria: (payload) => criarCategoriaAdmin(lojaId, payload),
        atualizarCategoria: (id, payload) =>
          atualizarCategoriaAdmin(lojaId, id, payload),
        removerCategoria: (id) => removerCategoriaAdmin(lojaId, id),
        alternarExibirImagens: (id, exibirImagens) =>
          alternarExibirImagensAdmin(lojaId, id, exibirImagens),
        // A action do lojista recebe `payload: unknown` (a sequência de ids) e
        // deriva `ordem` numa RPC; a admin recebe os pares `{ id, ordem }` já
        // formados. Só ADAPTAÇÃO DE FORMA: o `safeParse` reusa o mesmo schema do
        // servidor e existe apenas para tipar o `unknown` sem cast — a
        // autoridade (admin, escopo por `lojaId`, posse das categorias) continua
        // inteira na `reordenarCategoriasAdmin`.
        reordenarCategorias: async (payload) => {
          const parsed = schemaReordenacaoCategorias.safeParse(payload);
          if (!parsed.success) {
            return { ok: false, erro: "Não foi possível salvar a ordem." };
          }
          return reordenarCategoriasAdmin(
            lojaId,
            parsed.data.map((id, indice) => ({ id, ordem: indice })),
          );
        },
        criarProduto: (payload) => criarProdutoAdmin(lojaId, payload),
        atualizarProduto: (id, payload) =>
          atualizarProdutoAdmin(lojaId, id, payload),
        removerProduto: (id) => removerProdutoAdmin(lojaId, id),
        alternarDisponibilidade: (id, disponivel) =>
          alternarDisponibilidadeAdmin(lojaId, id, disponivel),
        alternarOculto: (id, oculto) => alternarOcultoAdmin(lojaId, id, oculto),
        enviarFotoProduto,
        salvarAssociacaoOpcionais: (payload) =>
          salvarAssociacaoOpcionaisAdmin(lojaId, payload),
        // [217] As 9 do CRUD de opcionais, mesmas assinaturas do
        // `OpcionaisAdminClient` (137): o modal do cardápio agora monta o mesmo
        // cartão, e `acoes` é OBRIGATÓRIA sem default (issue 160) — omitir
        // qualquer uma quebra o build em vez de cair na action do LOJISTA, que
        // resolveria a loja por `auth.uid()` e gravaria na loja do admin logado.
        criarCategoriaOpcional: (payload) =>
          criarCategoriaOpcionalAdmin(lojaId, payload),
        atualizarCategoriaOpcional: (id, payload) =>
          atualizarCategoriaOpcionalAdmin(lojaId, id, payload),
        removerCategoriaOpcional: (id) =>
          removerCategoriaOpcionalAdmin(lojaId, id),
        criarOpcional: (payload) => criarOpcionalAdmin(lojaId, payload),
        atualizarOpcional: (id, payload) =>
          atualizarOpcionalAdmin(lojaId, id, payload),
        alternarOpcionalAtivo: (id, ativo) =>
          alternarOpcionalAtivoAdmin(lojaId, id, ativo),
        removerOpcional: (id) => removerOpcionalAdmin(lojaId, id),
        reordenarOpcionaisDaCategoria: (payload) =>
          reordenarOpcionaisDaCategoriaAdmin(lojaId, payload),
        reordenarItensDoGrupoOpcional: (payload) =>
          reordenarItensDoGrupoOpcionalAdmin(lojaId, payload),
      }}
    />
  );
}

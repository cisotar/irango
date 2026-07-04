"use client";

import { useCallback } from "react";

import { ProdutosClient } from "@/app/(painel)/painel/produtos/ProdutosClient";
import type { Categoria } from "@/components/painel/FormProduto";
import type { Produto, OpcionaisPorCategoria } from "@/lib/supabase/queries/produtos";
import {
  criarCategoriaAdmin,
  atualizarCategoriaAdmin,
  removerCategoriaAdmin,
} from "@/app/admin/assinantes/actions/admin-categorias";
import {
  criarProdutoAdmin,
  atualizarProdutoAdmin,
  removerProdutoAdmin,
  alternarDisponibilidadeAdmin,
  alternarOcultoAdmin,
} from "@/app/admin/assinantes/actions/admin-produtos";
import { enviarFotoProdutoAdmin } from "@/app/admin/assinantes/actions/admin-upload";
import { salvarAssociacaoOpcionaisAdmin } from "@/app/admin/assinantes/actions/admin-opcionais";

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
  categoriasOpcional,
}: {
  lojaSlug: string;
  lojaId: string;
  produtos: Produto[];
  categorias: Categoria[];
  opcionaisPorCategoria: OpcionaisPorCategoria;
  categoriasOpcional: { id: string; nome: string }[];
}) {
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
      // Opcionais reais da loja-alvo (loader 132). Guard 122-129: habilitar
      // `categoriasOpcional` reais EXIGE injetar `salvarAssociacaoOpcionais`
      // admin no `acoes` (abaixo) na MESMA mudança — sem isso o fallback cai na
      // action do lojista (resolve loja por auth.uid() = admin → cross-tenant).
      opcionaisPorCategoria={opcionaisPorCategoria}
      categoriasOpcional={categoriasOpcional}
      acoes={{
        criarCategoria: (payload) => criarCategoriaAdmin(lojaId, payload),
        atualizarCategoria: (id, payload) =>
          atualizarCategoriaAdmin(lojaId, id, payload),
        removerCategoria: (id) => removerCategoriaAdmin(lojaId, id),
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
      }}
    />
  );
}

"use client";

import { OpcionaisClient } from "@/app/(painel)/painel/(bloqueavel)/produtos/opcionais/OpcionaisClient";
import type { OpcionaisClientProps } from "@/app/(painel)/painel/(bloqueavel)/produtos/opcionais/OpcionaisClient";
import {
  criarCategoriaOpcionalAdmin,
  atualizarCategoriaOpcionalAdmin,
  removerCategoriaOpcionalAdmin,
  criarOpcionalAdmin,
  atualizarOpcionalAdmin,
  alternarOpcionalAtivoAdmin,
  removerOpcionalAdmin,
  salvarAssociacaoOpcionaisAdmin,
} from "@/app/admin/assinantes/actions/admin-opcionais";

/**
 * Wrapper client da aba Opcionais do hub admin (issue 137). Reusa o
 * `OpcionaisClient` parametrizado do painel (128) — que já embute todo o CRUD de
 * categorias/itens/associações — e INJETA as Server Actions admin (135) com o
 * `lojaId` da URL fixado via closures. Zero markup próprio (segue o precedente
 * `CardapioAdminClient`, issue 100).
 *
 * Segurança: `lojaId` aqui é só o 1º argumento das chamadas; NÃO é barreira. A
 * autoridade (validação UUID via `validarLojaIdAdmin`, escopo cross-loja, prova
 * de posse das FKs, `service_role` só após `verificarAdminSaaS`) é das actions
 * admin no servidor. As actions admin têm assinatura `(lojaId, ...)`; os
 * wrappers abaixo adaptam para a forma sem `lojaId` que o `OpcionaisClient`
 * espera (mesmas assinaturas das actions do lojista).
 *
 * Os dados chegam já nos shapes estreitos que o `OpcionaisClient` exige — o
 * mapeamento dos tipos largos do agregado (132) fica na page (142), espelhando
 * a `page.tsx` do painel.
 */
export function OpcionaisAdminClient({
  lojaId,
  categoriasOpcional,
  opcionais,
  categoriasProduto,
  associacoes,
}: {
  lojaId: string;
} & Pick<
  OpcionaisClientProps,
  "categoriasOpcional" | "opcionais" | "categoriasProduto" | "associacoes"
>) {
  return (
    <OpcionaisClient
      categoriasOpcional={categoriasOpcional}
      opcionais={opcionais}
      categoriasProduto={categoriasProduto}
      associacoes={associacoes}
      acoes={{
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
        salvarAssociacaoOpcionais: (payload) =>
          salvarAssociacaoOpcionaisAdmin(lojaId, payload),
      }}
    />
  );
}

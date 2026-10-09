"use client";

import type { ReactElement } from "react";

import {
  PromocoesClient,
  type ModalSazonalLinha,
  type OpcaoSelecao,
} from "@/app/(painel)/painel/(bloqueavel)/configuracoes/promocoes/PromocoesClient";

import {
  criarModalSazonalAdmin,
  editarModalSazonalAdmin,
  ativarModalSazonalAdmin,
  desativarModalSazonalAdmin,
  removerModalSazonalAdmin,
} from "@/app/admin/assinantes/actions/admin-modal-sazonal";

/**
 * [362] Wrapper admin FINO da sub-rota de Avisos. Reusa o `PromocoesClient` do
 * painel (302) e INJETA as 5 actions admin com o `lojaId` da URL fixado por
 * closure — molde de `TemaAdminClient`.
 *
 * `acoes` é obrigatória no `PromocoesClient` (sem default, issue 160): esquecer
 * uma chave não compila, e nenhuma action do LOJISTA (que resolve a loja por
 * `auth.uid()`) chega aqui por fallback. A autoridade é a Server Action, que
 * revalida o payload, prova admin antes de elevar e amarra a loja-alvo ao
 * `lojaId` validado — aqui é só fiação de UI.
 */
export function PromocoesAdminClient({
  lojaId,
  modais,
  categorias,
}: {
  lojaId: string;
  modais: ModalSazonalLinha[];
  categorias: OpcaoSelecao[];
}): ReactElement {
  return (
    <PromocoesClient
      modais={modais}
      categorias={categorias}
      acoes={{
        criar: (payload) => criarModalSazonalAdmin(lojaId, payload),
        editar: (id, payload) => editarModalSazonalAdmin(lojaId, id, payload),
        ativar: (id) => ativarModalSazonalAdmin(lojaId, id),
        desativar: (id) => desativarModalSazonalAdmin(lojaId, id),
        remover: (id) => removerModalSazonalAdmin(lojaId, id),
      }}
    />
  );
}

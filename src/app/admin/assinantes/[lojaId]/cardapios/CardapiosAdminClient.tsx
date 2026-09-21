"use client";

import type { ReactElement } from "react";

import {
  CardapiosClient,
  type LinhaCardapio,
} from "@/app/(painel)/painel/(bloqueavel)/cardapios/CardapiosClient";
import {
  ligarDesligarCardapioAdmin,
  removerCardapioAdmin,
  converterExclusivosParaMenuAdmin,
} from "@/app/admin/assinantes/actions/admin-cardapios";
import { definirVisibilidadeEmProdutosAdmin } from "@/app/admin/assinantes/actions/admin-produtos";
import { rotaCardapiosAdmin } from "@/lib/utils/rotasCardapios";

/**
 * [269 · fase 6] Wrapper client da lista de cardápios do hub admin. Reusa o
 * `CardapiosClient` do painel do lojista — NENHUM markup copiado — e injeta as
 * Server Actions admin com o `lojaId` da URL fixado por closure, mais a base de
 * rota deste mundo.
 *
 * Wrapper (e não `.bind(null, lojaId)` na page) por causa de D4: a suíte
 * `enforcement-props-action-admin.test.ts` descobre `*AdminClient.tsx` por
 * filesystem e exige que TODA prop de action do componente do painel seja
 * injetada. Esquecer uma faria a action do LOJISTA rodar, resolver a loja por
 * `auth.uid()` e gravar na loja do ADMIN LOGADO.
 *
 * `lojaId` aqui é só para montar a chamada: a autoridade (prova de admin,
 * validação do UUID, escopo por `loja_id`) mora inteira nas actions admin.
 */
export function CardapiosAdminClient({
  lojaId,
  cardapios,
}: {
  lojaId: string;
  cardapios: LinhaCardapio[];
}): ReactElement {
  return (
    <CardapiosClient
      cardapios={cardapios}
      baseCardapios={rotaCardapiosAdmin(lojaId)}
      acoes={{
        ligarDesligar: (id, ativo) =>
          ligarDesligarCardapioAdmin(lojaId, id, ativo),
        // [285] O modo sobe como está; quem o valida (`schemaModoRemocao`) e
        // quem recalcula os produtos afetados é a action admin, sob o
        // `lojaId` da URL — nunca este wrapper.
        remover: (id, modo) => removerCardapioAdmin(lojaId, id, modo),
        converter: (cardapioId) =>
          converterExclusivosParaMenuAdmin(lojaId, cardapioId),
        devolverAoMenu: (payload) =>
          definirVisibilidadeEmProdutosAdmin(lojaId, payload),
      }}
    />
  );
}

"use client";

import type { ReactElement } from "react";

import {
  FormVigencia,
  type FormVigenciaProps,
} from "@/components/painel/FormVigencia";
import {
  SeletorProdutosDoCardapio,
  type SeletorProdutosDoCardapioProps,
} from "@/components/painel/SeletorProdutosDoCardapio";
import {
  atualizarCardapioAdmin,
  aplicarCardapioEmProdutosAdmin,
  aplicarCardapioEmCategoriaAdmin,
  tirarDeCardapioAdmin,
  preverLoteAdmin,
  definirDiasDoVinculoAdmin,
} from "@/app/admin/assinantes/actions/admin-cardapios";
import { definirVisibilidadeEmProdutosAdmin } from "@/app/admin/assinantes/actions/admin-produtos";
import { rotaCardapiosAdmin } from "@/lib/utils/rotasCardapios";

/**
 * [269 · fase 6] Wrapper client do detalhe de cardápio no hub admin. Reusa
 * `FormVigencia` + `SeletorProdutosDoCardapio` do painel — NENHUM markup
 * copiado — e injeta as SETE Server Actions admin (`salvar` + as 6 de
 * `AcoesLote`) com o `lojaId` da URL fixado por closure.
 *
 * As seis de `acoes` são OBRIGATÓRIAS e sem default (issue 160): omitir
 * qualquer uma faria a action do LOJISTA rodar, resolver a loja por
 * `auth.uid()` e escrever na loja do ADMIN LOGADO.
 */
export function CardapioDetalheAdminClient({
  lojaId,
  cardapioId,
  cardapio,
  timezone,
  fusoRotulo,
  agoraLocal,
  linhaAgora,
  cardapioDoLote,
  grupos,
}: {
  lojaId: string;
  cardapioId: string;
  cardapioDoLote: SeletorProdutosDoCardapioProps["cardapio"];
  grupos: SeletorProdutosDoCardapioProps["grupos"];
} & Pick<
  FormVigenciaProps,
  "cardapio" | "timezone" | "fusoRotulo" | "agoraLocal" | "linhaAgora"
>): ReactElement {
  return (
    <>
      <FormVigencia
        cardapio={cardapio}
        timezone={timezone}
        fusoRotulo={fusoRotulo}
        agoraLocal={agoraLocal}
        linhaAgora={linhaAgora}
        salvar={(payload) => atualizarCardapioAdmin(lojaId, cardapioId, payload)}
        voltarHref={rotaCardapiosAdmin(lojaId)}
      />

      <SeletorProdutosDoCardapio
        cardapio={cardapioDoLote}
        grupos={grupos}
        acoes={{
          aplicarEmProdutos: (payload) =>
            aplicarCardapioEmProdutosAdmin(lojaId, payload),
          aplicarEmCategoria: (payload) =>
            aplicarCardapioEmCategoriaAdmin(lojaId, payload),
          tirarDeCardapio: (payload) => tirarDeCardapioAdmin(lojaId, payload),
          preverLote: (entrada) => preverLoteAdmin(lojaId, entrada),
          definirVisibilidade: (payload) =>
            definirVisibilidadeEmProdutosAdmin(lojaId, payload),
          definirDias: (payload) => definirDiasDoVinculoAdmin(lojaId, payload),
        }}
      />
    </>
  );
}

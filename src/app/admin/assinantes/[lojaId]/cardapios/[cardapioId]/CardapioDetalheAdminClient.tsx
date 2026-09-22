"use client";

import type { ReactElement } from "react";

import type { FormVigenciaProps } from "@/components/painel/FormVigencia";
import { VigenciaRecolhida } from "@/components/painel/VigenciaRecolhida";
import {
  DetalheDoCardapio,
  type DetalheDoCardapioProps,
} from "@/components/painel/DetalheDoCardapio";
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
 * [269 · fase 6 · 288] Wrapper client do detalhe de cardápio no hub admin.
 * Reusa `VigenciaRecolhida` + `DetalheDoCardapio` do painel — NENHUM markup
 * copiado — e injeta as SETE Server Actions admin (`salvar` + as 6 de
 * `AcoesLote`) com o `lojaId` da URL fixado por closure.
 *
 * As seis de `acoes` são OBRIGATÓRIAS e sem default (issue 160): omitir
 * qualquer uma faria a action do LOJISTA rodar, resolver a loja por
 * `auth.uid()` e escrever na loja do ADMIN LOGADO.
 *
 * As rotas do painel do lojista NÃO existem aqui: `hrefProdutos` e
 * `hrefEditarProduto` entram `null`, que é contrato válido — um link fixo
 * `/painel/...` dentro do mundo admin mandaria o admin para a própria loja.
 */
export function CardapioDetalheAdminClient({
  lojaId,
  cardapioId,
  cardapio,
  timezone,
  fusoRotulo,
  agoraLocal,
  linhaAgora,
  resumoVigencia,
  cardapioDoLote,
  itens,
  grupos,
}: {
  lojaId: string;
  cardapioId: string;
  /** A frase de vigência de uma linha, do SERVIDOR (`descreverVigencia`). */
  resumoVigencia: string;
  cardapioDoLote: DetalheDoCardapioProps["cardapio"];
  itens: DetalheDoCardapioProps["itens"];
  grupos: DetalheDoCardapioProps["grupos"];
} & Pick<
  FormVigenciaProps,
  "cardapio" | "timezone" | "fusoRotulo" | "agoraLocal" | "linhaAgora"
>): ReactElement {
  return (
    <>
      <VigenciaRecolhida
        resumo={resumoVigencia}
        cardapio={cardapio}
        timezone={timezone}
        fusoRotulo={fusoRotulo}
        agoraLocal={agoraLocal}
        linhaAgora={linhaAgora}
        salvar={(payload) => atualizarCardapioAdmin(lojaId, cardapioId, payload)}
        voltarHref={rotaCardapiosAdmin(lojaId)}
      />

      <DetalheDoCardapio
        cardapio={cardapioDoLote}
        itens={itens}
        grupos={grupos}
        hrefProdutos={null}
        hrefEditarProduto={null}
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

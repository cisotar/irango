"use client";

import { GaleriaImagens } from "@/components/painel/GaleriaImagens";
import {
  consultarUsoImagensAdmin,
  enviarImagemGaleriaAdmin,
  listarImagensGaleriaAdmin,
  removerImagensGaleriaAdmin,
} from "@/app/admin/assinantes/actions/admin-galeria";
import type {
  CursorGaleria,
  ImagemGaleria,
  UsoImagem,
} from "@/lib/actions/galeria-contrato";

/**
 * Wrapper client da galeria no hub admin (specs/galeria-imagens-loja.md,
 * página 2). Reusa o `GaleriaImagens` do painel (o MESMO arquivo — "o painel
 * do lojista é a fonte única do front") e INJETA as variantes `*Admin` com o
 * `lojaId` da URL fixado em closure. No envio, o `loja_id` entra no FormData
 * (`set`, nunca `append`: um só valor, o da URL).
 *
 * Segurança: o `lojaId` daqui só monta a chamada. A autoridade é das actions
 * admin (validação do `lojaId`, prova de admin antes do service_role, escopo
 * por `loja_id`, trava de prefixo no Storage). O wrapper NÃO é barreira.
 */
export function GaleriaAdminClient({
  lojaId,
  imagensIniciais,
  cursorInicial,
  totalInicial,
  usosIniciais,
}: {
  lojaId: string;
  imagensIniciais: ImagemGaleria[];
  cursorInicial: CursorGaleria | null;
  totalInicial: number;
  usosIniciais: UsoImagem[];
}) {
  return (
    <GaleriaImagens
      voltarHref={`/admin/assinantes/${lojaId}`}
      voltarRotulo="Painel da loja"
      imagensIniciais={imagensIniciais}
      cursorInicial={cursorInicial}
      totalInicial={totalInicial}
      usosIniciais={usosIniciais}
      acoes={{
        enviarImagem: (formData) => {
          formData.set("loja_id", lojaId);
          return enviarImagemGaleriaAdmin(formData);
        },
        listarMais: (cursor) => listarImagensGaleriaAdmin(lojaId, cursor),
        consultarUso: (ids) => consultarUsoImagensAdmin(lojaId, ids),
        remover: (ids) => removerImagensGaleriaAdmin(lojaId, ids),
      }}
    />
  );
}

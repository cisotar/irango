"use client";

import { useCallback } from "react";

import { PerfilClient, type PerfilInicial } from "@/app/(painel)/painel/configuracoes/perfil/PerfilClient";
import { HorariosClient } from "@/app/(painel)/painel/configuracoes/horarios/HorariosClient";
import { TemaClient, type Tema } from "@/app/(painel)/painel/configuracoes/tema/TemaClient";
import { EntregasClient } from "@/app/(painel)/painel/configuracoes/entregas/EntregasClient";
import { PagamentosClient } from "@/app/(painel)/painel/configuracoes/pagamentos/PagamentosClient";
import type { Horarios } from "@/lib/utils/lojaAberta";
import type { EnviarQrPix, ResultadoUploadQr } from "@/components/painel/UploadQrPix";
import type {
  ZonaVitrine,
  FormaPagamento,
} from "@/lib/supabase/queries/entregaPagamento";

import { salvarPerfilAdmin } from "@/app/admin/assinantes/actions/admin-perfil";
import { publicarLojaAdmin } from "@/app/admin/assinantes/actions/admin-publicar";
import {
  salvarHorariosAdmin,
  salvarTemaAdmin,
} from "@/app/admin/assinantes/actions/admin-horarios-tema";
import {
  criarZonaAdmin,
  atualizarZonaAdmin,
  removerZonaAdmin,
} from "@/app/admin/assinantes/actions/admin-entrega";
import {
  salvarFormaPagamentoAdmin,
  atualizarFormaPagamentoAdmin,
  removerFormaPagamentoAdmin,
  salvarQrPixAdmin,
  enviarQrPixAdmin,
} from "@/app/admin/assinantes/actions/admin-pagamento";

/**
 * Wrapper client da aba Configuração do hub admin (issue 101). Reusa os clients
 * parametrizados do painel (097) — `PerfilClient`, `HorariosClient`, `TemaClient`,
 * `EntregasClient` e `PagamentosClient` — e INJETA as Server Actions admin
 * (091–095) com o `lojaId` da URL fixado via closures finas.
 *
 * Segurança: aqui é só fiação de UI. A autoridade (allowlist de colunas,
 * geocoding, taxa, chave Pix, gate de `ativo`, path de upload, escopo cross-loja)
 * é das actions admin no servidor. As actions admin têm assinatura `(lojaId, ...)`;
 * os wrappers abaixo adaptam para a forma sem `lojaId` que cada client espera
 * (mesmas assinaturas das actions do lojista).
 *
 * O controle "Publicar loja" (RN-8) já vem embutido no `PerfilClient` via
 * `onDefinirPublicacao` — aqui injetamos `publicarLojaAdmin(lojaId, publicar)`.
 */
export function ConfiguracaoAdminClient({
  lojaId,
  perfilInicial,
  publicado,
  podePublicar,
  logoUrlInicial,
  horariosInicial,
  timezone,
  temaInicial,
  nomeLoja,
  zonas,
  formasPagamento,
}: {
  lojaId: string;
  perfilInicial: PerfilInicial;
  publicado: boolean;
  podePublicar: boolean;
  logoUrlInicial: string | null;
  horariosInicial: Horarios | null;
  timezone: string;
  temaInicial: Tema;
  nomeLoja: string;
  zonas: ZonaVitrine[];
  formasPagamento: FormaPagamento[];
}) {
  // O `UploadQrPix` chama `onEnviar(lojaId, arquivo)` e espera `ResultadoUploadQr`.
  // A action admin recebe um FormData (lê `loja_id` dele) e devolve outra forma de
  // resultado — este adapter monta o FormData com o `lojaId` da URL e mapeia o
  // retorno. A autoridade (validação UUID, magic bytes, path server-side) é da action.
  const enviarQrPix = useCallback<EnviarQrPix>(
    async (_lojaIdDoComponente, arquivo): Promise<ResultadoUploadQr> => {
      const formData = new FormData();
      formData.set("loja_id", lojaId);
      formData.set("file", arquivo);
      const resultado = await enviarQrPixAdmin(formData);
      return resultado.ok
        ? { urlPublica: resultado.pix_qr_url }
        : { erro: resultado.erro };
    },
    [lojaId],
  );

  return (
    <div className="space-y-12">
      <PerfilClient
        inicial={perfilInicial}
        publicado={publicado}
        podePublicar={podePublicar}
        logoUrlInicial={logoUrlInicial}
        onSalvar={(payload) => salvarPerfilAdmin(lojaId, payload)}
        onDefinirPublicacao={(publicar) => publicarLojaAdmin(lojaId, publicar)}
      />

      <HorariosClient
        inicial={horariosInicial}
        timezone={timezone}
        onSalvar={(payload) => salvarHorariosAdmin(lojaId, payload)}
      />

      <TemaClient
        inicial={temaInicial}
        nomeLoja={nomeLoja}
        onSalvar={(payload) => salvarTemaAdmin(lojaId, payload)}
      />

      <EntregasClient
        zonas={zonas}
        acoes={{
          criarZona: (payload) => criarZonaAdmin(lojaId, payload),
          atualizarZona: (id, payload) =>
            atualizarZonaAdmin(lojaId, id, payload),
          removerZona: (id) => removerZonaAdmin(lojaId, id),
        }}
      />

      <PagamentosClient
        formas={formasPagamento}
        lojaId={lojaId}
        acoes={{
          salvarFormaPagamento: (payload) =>
            salvarFormaPagamentoAdmin(lojaId, payload),
          atualizarFormaPagamento: (id, payload) =>
            atualizarFormaPagamentoAdmin(lojaId, id, payload),
          removerFormaPagamento: (id) => removerFormaPagamentoAdmin(lojaId, id),
          salvarQrPix: (formaId, pixQrUrl) =>
            salvarQrPixAdmin(lojaId, formaId, pixQrUrl),
          enviarQrPix,
        }}
      />
    </div>
  );
}

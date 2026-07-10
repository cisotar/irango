"use client";

import { useCallback } from "react";

import { PagamentosClient } from "@/app/(painel)/painel/(bloqueavel)/configuracoes/pagamentos/PagamentosClient";
import type { EnviarQrPix, ResultadoUploadQr } from "@/components/painel/UploadQrPix";
import type { FormaPagamento } from "@/lib/supabase/queries/entregaPagamento";

import {
  salvarFormaPagamentoAdmin,
  atualizarFormaPagamentoAdmin,
  removerFormaPagamentoAdmin,
  salvarQrPixAdmin,
  enviarQrPixAdmin,
} from "@/app/admin/assinantes/actions/admin-pagamento";

/**
 * Wrapper admin fino da sub-rota de Pagamentos (issue 152). Reusa o
 * `PagamentosClient` do painel (097) e INJETA as actions admin de pagamento
 * (095) com o `lojaId` da URL fixado por closure.
 *
 * O `UploadQrPix` chama `onEnviar(lojaId, arquivo)` e espera `ResultadoUploadQr`;
 * a action admin recebe um FormData e devolve outra forma. O adapter monta o
 * FormData com o `lojaId` da URL e mapeia o retorno. A autoridade (validação
 * UUID, magic bytes, path server-side, chave Pix) é da action no servidor.
 */
export function PagamentosAdminClient({
  lojaId,
  formasPagamento,
}: {
  lojaId: string;
  formasPagamento: FormaPagamento[];
}) {
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
  );
}

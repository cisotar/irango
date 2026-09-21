"use client";

import type { ReactElement } from "react";

import {
  FormVigencia,
  type FormVigenciaProps,
} from "@/components/painel/FormVigencia";
import { criarCardapioAdmin } from "@/app/admin/assinantes/actions/admin-cardapios";
import { rotaCardapiosAdmin } from "@/lib/utils/rotasCardapios";

/**
 * [269 · fase 6] Wrapper client da criação de cardápio no hub admin. Reusa o
 * `FormVigencia` do painel — NENHUM markup copiado — e injeta `criarCardapioAdmin`
 * com o `lojaId` da URL fixado por closure.
 *
 * A prova de admin, a validação do `lojaId`, o recálculo de `prazo_fim` (RN-04)
 * e o fuso da LOJA-ALVO são todos da action no servidor; o que vem daqui é só a
 * forma da chamada.
 */
export function NovoCardapioAdminClient({
  lojaId,
  timezone,
  fusoRotulo,
  agoraLocal,
}: {
  lojaId: string;
} & Pick<
  FormVigenciaProps,
  "timezone" | "fusoRotulo" | "agoraLocal"
>): ReactElement {
  return (
    <FormVigencia
      cardapio={null}
      timezone={timezone}
      fusoRotulo={fusoRotulo}
      agoraLocal={agoraLocal}
      // A linha "Agora:" só vale para configuração SALVA (design §9.4).
      linhaAgora={null}
      salvar={(payload) => criarCardapioAdmin(lojaId, payload)}
      voltarHref={rotaCardapiosAdmin(lojaId)}
    />
  );
}

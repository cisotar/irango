"use client";

import type { PerfilInicial } from "@/app/(painel)/painel/(bloqueavel)/configuracoes/perfil/PerfilClient";
import type { Tema } from "@/app/(painel)/painel/(bloqueavel)/configuracoes/tema/TemaClient";
import type { Horarios } from "@/lib/utils/lojaAberta";
import type {
  ZonaVitrine,
  FormaPagamento,
} from "@/lib/supabase/queries/entregaPagamento";

import { PerfilAdminClient } from "./perfil/PerfilAdminClient";
import { HorariosAdminClient } from "./horarios/HorariosAdminClient";
import { TemaAdminClient } from "./tema/TemaAdminClient";
import { EntregasAdminClient } from "./entregas/EntregasAdminClient";
import { PagamentosAdminClient } from "./pagamentos/PagamentosAdminClient";

/**
 * Wrapper client da aba Configuração CONSOLIDADA do hub admin (issue 101).
 *
 * A partir da issue 152 este componente apenas COMPÕE os 5 wrappers admin finos
 * co-locados com suas sub-rotas (`PerfilAdminClient`, `HorariosAdminClient`,
 * `TemaAdminClient`, `EntregasAdminClient`, `PagamentosAdminClient`) — cada um já
 * fixa o `lojaId` por closure e injeta a action admin correspondente. Zero
 * markup/fiação duplicada: a autoridade de cada seção vive nos wrappers/actions.
 *
 * A assinatura de props externa NÃO muda (a page consolidada segue chamando
 * igual até a issue 154 aposentar esta consolidação).
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
  return (
    <div className="space-y-12">
      <PerfilAdminClient
        lojaId={lojaId}
        inicial={perfilInicial}
        publicado={publicado}
        podePublicar={podePublicar}
        logoUrlInicial={logoUrlInicial}
      />

      <HorariosAdminClient
        lojaId={lojaId}
        inicial={horariosInicial}
        timezone={timezone}
      />

      <TemaAdminClient
        lojaId={lojaId}
        temaInicial={temaInicial}
        nomeLoja={nomeLoja}
      />

      <EntregasAdminClient lojaId={lojaId} zonas={zonas} />

      <PagamentosAdminClient lojaId={lojaId} formasPagamento={formasPagamento} />
    </div>
  );
}

// Fonte ÚNICA da regra de autorização do painel (issue 016). PURA, testável,
// sem I/O e sem Date.now() — `agora` é injetado. O guard (layout.tsx) faz o I/O
// e apenas APLICA a decisão. Reusa `assinaturaPermiteAcesso` (056) — não recria
// a regra de carência. Precedência fixa: sessão → email → loja → assinatura(+exceção).
import type { User } from "@supabase/supabase-js";
import type { LojaCompleta } from "@/lib/supabase/queries/lojas";
import {
  assinaturaPermiteAcesso,
  type StatusAssinatura,
} from "./assinatura";

export type DecisaoPainel =
  | "ok"
  | "login"
  | "confirmar-email"
  | "onboarding"
  | "assinatura-bloqueada";

// Rotas acessíveis mesmo com assinatura inválida (anti-loop). Prefixo de pathname.
export const ROTAS_EXCECAO_ASSINATURA: readonly string[] = [
  "/painel/assinatura-bloqueada",
  "/painel/configuracoes/assinatura",
];

// Status conhecidos do union. `ativa`/`cortesia`/`suspensa` não dependem de `fim`;
// os demais exigem `assinatura_fim_periodo` para avaliar a carência (fail-closed se null).
const STATUS_CONHECIDOS: readonly StatusAssinatura[] = [
  "trial",
  "ativa",
  "inadimplente",
  "cancelada",
  "suspensa",
  "cortesia",
];

/**
 * Decide o acesso de assinatura em postura fail-closed (D4): qualquer dúvida
 * sobre o estado da assinatura → bloqueia. Só chama o util quando há dados
 * suficientes e confiáveis para avaliar.
 */
function assinaturaLibera(loja: LojaCompleta, agora: Date): boolean {
  const status = loja.assinatura_status as string;

  // Status fora do union conhecido (input não-confiável vindo do banco) → bloqueia.
  if (!STATUS_CONHECIDOS.includes(status as StatusAssinatura)) {
    return false;
  }
  const statusConhecido = status as StatusAssinatura;

  // `ativa`/`cortesia` liberam sempre — o util ignora `fim` (RN-4, RN-12).
  // `suspensa` bloqueia sempre — corte imediato, sem carência.
  if (statusConhecido === "ativa" || statusConhecido === "cortesia") {
    return true;
  }
  if (statusConhecido === "suspensa") {
    return false;
  }

  // trial | inadimplente | cancelada: exigem `fim` para avaliar a carência.
  // Sem `fim` não dá pra avaliar a regra → fail-closed (bloqueia).
  const fim = loja.assinatura_fim_periodo;
  if (fim === null || fim === undefined) {
    return false;
  }

  return assinaturaPermiteAcesso(statusConhecido, new Date(fim), agora);
}

export function decidirAcessoPainel(
  user: User | null,
  loja: LojaCompleta | null,
  rota: string,
  agora: Date,
): DecisaoPainel {
  // 1. Sessão — vence tudo (anônimo nunca vê tela de bloqueio).
  if (user === null) {
    return "login";
  }

  // 2. Email não confirmado — defesa em profundidade (§17). Cobre undefined E null.
  if (!user.email_confirmed_at) {
    return "confirmar-email";
  }

  // 3. Sessão+email OK mas sem loja (user órfão) → onboarding.
  if (loja === null) {
    return "onboarding";
  }

  // 4. Assinatura (fail-closed). A exceção de rota cobre SÓ este bloqueio (anti-loop).
  if (!assinaturaLibera(loja, agora)) {
    const emExcecao = ROTAS_EXCECAO_ASSINATURA.some((prefixo) =>
      rota.startsWith(prefixo),
    );
    if (emExcecao) {
      return "ok";
    }
    return "assinatura-bloqueada";
  }

  // 5. Tudo ok.
  return "ok";
}

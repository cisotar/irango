import { describe, it, expect } from "vitest";
import * as acessoPainel from "./acessoPainel";

/**
 * Fase RED (issue 142, crítica: TDD red-first — deleção do acoplamento a `rota`).
 *
 * A issue 142 remove o gate de assinatura baseado em STRING de transporte:
 * `decidirAcessoPainel(user, loja, rota, agora)` e a lista `ROTAS_EXCECAO_ASSINATURA`
 * (o passo anti-loop por prefixo de pathname) deixam de existir. A isenção do
 * paywall passa a ser POSICIONAL (route group `(bloqueavel)/`), não por comparação
 * de header de pathname vindo do transporte (imune a header forjado — classe
 * CVE-2025-29927, spec §RN-02/RN-03).
 *
 * O que sobra em `acessoPainel.ts` são as duas funções PURAS da issue 140:
 * `decidirAcessoBase` (sessão/email/loja) e `decidirAssinatura` (só assinatura).
 *
 * TRAP anti-regressão: enquanto `decidirAcessoPainel` ou `ROTAS_EXCECAO_ASSINATURA`
 * ainda estiverem exportados (hoje estão — GREEN é da 142), estes testes ficam
 * VERMELHOS. Viram VERDES no instante em que a 142 deletar os dois símbolos, e
 * seguem travando a re-introdução do acoplamento a rota de transporte.
 *
 * Namespace import (`* as`) de propósito: acessar um named export inexistente via
 * namespace devolve `undefined` em runtime (não quebra o módulo), então este
 * arquivo continua válido DEPOIS da deleção — diferente de `acessoPainel.test.ts`,
 * que faz named-import direto dos símbolos e será reescrito na fase GREEN.
 */

const mod = acessoPainel as Record<string, unknown>;

describe("142 — deleção do gate por rota (decidirAcessoPainel / ROTAS_EXCECAO_ASSINATURA)", () => {
  it("NÃO exporta mais `decidirAcessoPainel` (gate por rota removido)", () => {
    expect(mod.decidirAcessoPainel).toBeUndefined();
  });

  it("NÃO exporta mais `ROTAS_EXCECAO_ASSINATURA` (anti-loop virou posicional)", () => {
    expect(mod.ROTAS_EXCECAO_ASSINATURA).toBeUndefined();
  });

  it("mantém as duas funções puras da 140 (`decidirAcessoBase` e `decidirAssinatura`)", () => {
    // Contra-prova: a deleção remove SÓ o acoplamento a rota, não a authz pura.
    expect(typeof mod.decidirAcessoBase).toBe("function");
    expect(typeof mod.decidirAssinatura).toBe("function");
  });
});

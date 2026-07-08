import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Fase RED (issue 143, crítica: TDD red-first — remoção do transporte de authz).
 *
 * `updateSession` deve ficar SÓ como refresh de cookie/sessão (`getUser`). A linha
 * que gravava um header de pathname no request a partir da URL (extinta na issue
 * 143 — antes em middleware.ts:8) era a ÚLTIMA entrada de transporte que
 * alimentava o gate de assinatura do painel — depois das issues 140/142 o layout
 * parou de lê-la, sobrou só a gravação. A verdade da autorização não pode ter
 * nenhum input controlável pelo cliente (spec §RN-02/RN-05, classe CVE-2025-29927).
 *
 * TRAP anti-regressão (comportamental): enquanto aquela linha existir,
 * `updateSession` grava o header de pathname no request e o 1º teste fica
 * VERMELHO. Vira VERDE no instante em que a fase GREEN remover a gravação, e
 * segue travando a re-introdução do header. O 2º teste é a contra-prova: a
 * remoção NÃO pode matar o refresh de sessão — `getUser` continua sendo chamado.
 *
 * Nota (issue 144): o nome literal do header só permanece na chamada de
 * `request.headers.get(...)` do primeiro teste, abaixo — ali a string É o
 * contrato do teste (confirmar a ausência DESSE header específico, não de
 * headers em geral). O restante desta narrativa evita repetir a string.
 *
 * `@supabase/ssr` é mockado: `createServerClient` vira um stub cujo `auth.getUser`
 * resolve sem rede. Nenhum Supabase real, nenhum cookie real (a config de cookies
 * do client nunca é exercida porque o client inteiro é stub).
 */

const getUserMock = vi.fn(async () => ({ data: { user: null }, error: null }));

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(() => ({
    auth: { getUser: getUserMock },
  })),
}));

import { updateSession } from "./middleware";

describe("143 — updateSession não propaga mais header de pathname (só refresh de sessão)", () => {
  it("NÃO grava mais o antigo header de pathname no request (authz sem input de transporte)", async () => {
    const request = new NextRequest("http://localhost/painel/produtos");

    await updateSession(request);

    // Enquanto middleware.ts:8 gravar o header, isto é a string "/painel/produtos"
    // e o teste falha. GREEN o remove -> null.
    expect(request.headers.get("x-pathname")).toBeNull();
  });

  it("ainda faz refresh de sessão via getUser (a remoção não pode quebrar isto)", async () => {
    getUserMock.mockClear();
    const request = new NextRequest("http://localhost/painel/pedidos");

    await updateSession(request);

    // Contra-prova: `updateSession` continua sendo o refresh de cookie/sessão.
    expect(getUserMock).toHaveBeenCalledTimes(1);
  });
});

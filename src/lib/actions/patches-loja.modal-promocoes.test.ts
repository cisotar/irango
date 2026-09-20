// Fase RED (TDD) — issue 231 (crítica: SIM, red-first). Arquivo NOVO, ao lado do
// módulo: `patches-loja.test.ts` (suíte da issue 084/122) não é editado aqui.
//
// O que se prova: `modal_promocoes` entra na allowlist ÚNICA de
// `montarPatchPerfil` (src/lib/actions/patches-loja.ts) com o teste de
// `!== undefined` — NUNCA truthiness. O bug clássico de booleano em allowlist é
// `if (v) patch.v = v`, que engole `false` em silêncio: o lojista marca
// "não mostrar o modal de promoções", o save volta ok, e o modal continua
// aparecendo para todo cliente da vitrine.
//
// Espelho do precedente literal `whatsapp_envio_automatico` (issue 122).
//
// NENHUMA lógica de produção aqui: os casos chamam a função real e afirmam o
// patch esperado. O campo ainda não existe em `DadosPerfil`, então o payload é
// forjado com `as unknown as DadosPerfil` (mesmo padrão do caso hostil da suíte
// 084) — assim o RED cai na ASSERÇÃO e não num erro de type-check.

import { describe, it, expect } from "vitest";
import { montarPatchPerfil, type DadosPerfil } from "./patches-loja";

const BASE = { nome: "Bar do João", slug: "bar-do-joao" };

describe("montarPatchPerfil — modal_promocoes na allowlist (issue 231)", () => {
  it("GRAVA modal_promocoes quando FALSE (checa !== undefined, não truthiness)", () => {
    const patch = montarPatchPerfil({
      ...BASE,
      modal_promocoes: false,
    } as unknown as DadosPerfil);

    // A asserção que mata o `if (v)`: a chave tem de EXISTIR com o valor false.
    expect("modal_promocoes" in patch).toBe(true);
    expect(patch.modal_promocoes).toBe(false);
    expect(patch).toEqual({ ...BASE, modal_promocoes: false });
  });

  it("GRAVA modal_promocoes quando TRUE", () => {
    const patch = montarPatchPerfil({
      ...BASE,
      modal_promocoes: true,
    } as unknown as DadosPerfil);

    expect(patch).toEqual({ ...BASE, modal_promocoes: true });
  });

  it("NÃO inclui modal_promocoes quando ausente (preserva o valor no banco)", () => {
    const patch = montarPatchPerfil({ ...BASE } as DadosPerfil);

    // Ausente NÃO pode virar `true` (o DEFAULT da coluna) nem `false`: o patch
    // simplesmente não toca a coluna, e o valor escolhido antes sobrevive.
    expect("modal_promocoes" in patch).toBe(false);
    expect(patch).toEqual(BASE);
  });

  it("SEGURANÇA RN-7: modal_promocoes entra, mas coluna fora da allowlist NÃO", () => {
    // Payload hostil COM o campo novo: o campo novo não pode servir de carona
    // para nenhuma coluna autoritativa (billing/estado/coords).
    const patch = montarPatchPerfil({
      ...BASE,
      modal_promocoes: false,
      ativo: true,
      dono_id: "00000000-0000-0000-0000-000000000000",
      assinatura_status: "ativa",
      hotmart_subscriber_code: "HACK231",
      latitude: -23.5,
      longitude: -46.6,
      id: "11111111-1111-1111-1111-111111111111",
    } as unknown as DadosPerfil);

    expect(Object.keys(patch).sort()).toEqual(
      ["modal_promocoes", "nome", "slug"].sort(),
    );
    for (const proibida of [
      "ativo",
      "dono_id",
      "assinatura_status",
      "hotmart_subscriber_code",
      "latitude",
      "longitude",
      "id",
    ]) {
      expect(proibida in patch).toBe(false);
    }
  });
});

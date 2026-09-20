// Fase RED (TDD) — issue 231 (crítica: SIM, red-first). Arquivo NOVO: a suíte
// existente `montarPayloadPerfil.test.ts` não é editada aqui.
//
// A ponta do LOJISTA. O payload do form é onde o `false` morre primeiro: o
// arquivo usa spread condicional (`...(x ? {x} : {})`) nos textos, e o
// precedente `whatsapp_envio_automatico` já documenta por que o booleano tem de
// ser SEMPRE presente — com spread condicional o lojista nunca conseguiria
// DESLIGAR a preferência. Mesmo raciocínio, mesmo teste, campo novo.
//
// Caso-espelho: o valor que sai daqui é o mesmo que `montarPatchPerfil` precisa
// gravar (ver patches-loja.modal-promocoes.test.ts) e o mesmo que o admin grava
// (ver admin-perfil.modal-promocoes.test.ts). Uma regra, três pontas.

import { describe, it, expect } from "vitest";
import { montarPayloadPerfil, type CamposPerfil } from "./montarPayloadPerfil";

const CAMPOS_BASE = {
  nome: "Bar do João",
  slug: "bar-do-joao",
  telefone: "",
  whatsapp: "",
  envioAutomatico: true,
  enderecoCep: "",
  enderecoRua: "",
  enderecoNumero: "",
  enderecoBairro: "",
  enderecoCidade: "",
  enderecoEstado: "",
};

describe("montarPayloadPerfil — modal_promocoes sempre presente (issue 231)", () => {
  it("emite modal_promocoes: false quando o lojista DESLIGA o modal", () => {
    const payload = montarPayloadPerfil({
      ...CAMPOS_BASE,
      mostrarModalPromocoes: false,
    } as unknown as CamposPerfil) as Record<string, unknown>;

    // Sem spread condicional: a chave existe com `false`, senão desligar o modal
    // é impossível (o payload sem a chave preserva o valor no banco).
    expect("modal_promocoes" in payload).toBe(true);
    expect(payload.modal_promocoes).toBe(false);
  });

  it("emite modal_promocoes: true quando o lojista mantém o modal ligado", () => {
    const payload = montarPayloadPerfil({
      ...CAMPOS_BASE,
      mostrarModalPromocoes: true,
    } as unknown as CamposPerfil) as Record<string, unknown>;

    expect(payload.modal_promocoes).toBe(true);
  });
});

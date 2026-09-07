/**
 * `montarPayloadPerfil` — montagem do payload do form de perfil (issue 123).
 *
 * Lacuna que este arquivo fecha: enquanto a montagem vivia dentro do
 * `PerfilClient` (fechando sobre o `useState`, só executando no submit real do
 * form), nenhum teste conseguia prová-la — o projeto não tem jsdom nem
 * @testing-library, então `renderToStaticMarkup` não dispara eventos e
 * `PerfilClient.test.tsx` só assere sobre markup estático.
 *
 * Regra mais valiosa coberta aqui: `whatsapp_envio_automatico` está SEMPRE no
 * payload, inclusive quando `false`. Trocar a linha por um spread condicional
 * (`...(envioAutomatico ? { whatsapp_envio_automatico: true } : {})`) faz o
 * lojista NUNCA conseguir desligar o envio automático, porque a chave ausente
 * é justamente o que a Server Action interpreta como "preserva o que está no
 * banco" (`montarPatchPerfil` só grava quando `!== undefined`). O primeiro
 * teste abaixo é o que mata essa mutação.
 */

import { describe, it, expect } from "vitest";

import { schemaPerfil } from "@/lib/validacoes/loja";
import {
  apenasDigitos,
  montarPayloadPerfil,
  type CamposPerfil,
} from "./montarPayloadPerfil";

/** Form em branco: só nome/slug preenchidos, todo o resto vazio. */
const CAMPOS_BASE: CamposPerfil = {
  nome: "Loja Teste",
  slug: "loja-teste",
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

function montar(extra: Partial<CamposPerfil> = {}) {
  return montarPayloadPerfil({ ...CAMPOS_BASE, ...extra });
}

describe("montarPayloadPerfil — whatsapp_envio_automatico (issue 123)", () => {
  it("inclui `whatsapp_envio_automatico: false` NO PAYLOAD (chave presente, não só valor falsy) — sem isso o lojista nunca consegue DESLIGAR o envio", () => {
    const payload = montar({ envioAutomatico: false });

    // `toHaveProperty` + `in`: um spread condicional passaria num
    // `toBe(undefined)`, mas falha aqui porque a CHAVE deixaria de existir.
    expect("whatsapp_envio_automatico" in payload).toBe(true);
    expect(Object.keys(payload)).toContain("whatsapp_envio_automatico");
    expect(payload).toHaveProperty("whatsapp_envio_automatico", false);
    expect(payload.whatsapp_envio_automatico).not.toBeUndefined();
  });

  it("inclui `whatsapp_envio_automatico: true` quando ligado", () => {
    const payload = montar({ envioAutomatico: true });

    expect(payload).toHaveProperty("whatsapp_envio_automatico", true);
  });

  it("manda o booleano mesmo sem WhatsApp cadastrado — a chave não depende dos outros campos", () => {
    const payload = montar({ whatsapp: "", envioAutomatico: false });

    expect("whatsapp" in payload).toBe(false);
    expect(payload).toHaveProperty("whatsapp_envio_automatico", false);
  });
});

describe("montarPayloadPerfil — normalização dos campos", () => {
  it("aplica trim() em nome e slug", () => {
    const payload = montar({ nome: "  Burguer do Zé  ", slug: "  burguer-do-ze " });

    expect(payload.nome).toBe("Burguer do Zé");
    expect(payload.slug).toBe("burguer-do-ze");
  });

  it("prefixa o WhatsApp com `55` a partir dos dígitos da máscara", () => {
    const payload = montar({ whatsapp: "(11) 99999-9999" });

    expect(payload).toHaveProperty("whatsapp", "5511999999999");
  });

  it("omite o WhatsApp quando não há dígito nenhum (máscara vazia)", () => {
    const payload = montar({ whatsapp: "() -" });

    expect("whatsapp" in payload).toBe(false);
  });

  it("normaliza o telefone para dígitos e o omite quando vazio", () => {
    expect(montar({ telefone: "(11) 98888-7777" })).toHaveProperty(
      "telefone",
      "11988887777",
    );
    expect("telefone" in montar({ telefone: "" })).toBe(false);
  });

  it("OMITE os campos de texto vazios (o schema os trata como opcionais e a action preserva o que está gravado)", () => {
    const payload = montar();

    for (const chave of [
      "telefone",
      "whatsapp",
      "endereco_cep",
      "endereco_rua",
      "endereco_numero",
      "endereco_bairro",
      "endereco_cidade",
      "endereco_estado",
    ]) {
      expect(Object.keys(payload)).not.toContain(chave);
    }
    // Só sobram os obrigatórios + o booleano sempre presente.
    expect(Object.keys(payload).sort()).toEqual([
      "nome",
      "slug",
      "whatsapp_envio_automatico",
    ]);
  });

  it("campo de endereço só com espaços conta como vazio (é omitido, não vira string em branco)", () => {
    const payload = montar({ enderecoRua: "   ", enderecoCidade: "  São Paulo " });

    expect("endereco_rua" in payload).toBe(false);
    expect(payload).toHaveProperty("endereco_cidade", "São Paulo");
  });
});

describe("montarPayloadPerfil — contrato com o schemaPerfil do servidor", () => {
  it("payload completo passa no `schemaPerfil.safeParse` e carrega o booleano DESLIGADO até o outro lado", () => {
    const payload = montar({
      nome: "  Burguer do Zé ",
      slug: "burguer-do-ze",
      telefone: "(11) 98888-7777",
      whatsapp: "(11) 99999-9999",
      envioAutomatico: false,
      enderecoCep: "01310-100",
      enderecoRua: "Avenida Paulista",
      enderecoNumero: "1000",
      enderecoBairro: "Bela Vista",
      enderecoCidade: "São Paulo",
      enderecoEstado: "sp",
    });

    const parsed = schemaPerfil.safeParse(payload);

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.whatsapp_envio_automatico).toBe(false);
    expect(parsed.data.whatsapp).toBe("5511999999999");
    expect(parsed.data.endereco_estado).toBe("SP");
  });

  it("payload mínimo (form em branco) também passa — o `.strict()` não vê chave extra", () => {
    const parsed = schemaPerfil.safeParse(montar({ envioAutomatico: false }));

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.whatsapp_envio_automatico).toBe(false);
  });
});

describe("apenasDigitos", () => {
  it("remove tudo que não é dígito", () => {
    expect(apenasDigitos("(11) 99999-9999")).toBe("11999999999");
    expect(apenasDigitos("() -")).toBe("");
  });
});

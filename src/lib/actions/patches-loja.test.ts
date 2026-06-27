// TDD RED-first (issue 084 — crítica: SIM): builders puros de patch (allowlist)
// compartilhados painel ↔ admin. O módulo src/lib/actions/patches-loja.ts AINDA
// NÃO EXISTE — a fase GREEN (executar) o cria.
//
// O alvo de SEGURANÇA é a allowlist do RN-7 (seguranca.md §2): montarPatchPerfil
// SÓ pode emitir as colunas permitidas. Colunas autoritativas (dono_id, ativo,
// assinatura_*, hotmart_*, consentimento_*, id, latitude, longitude) JAMAIS
// entram no patch. Estes testes TRAVAM a lista exata extraída de
// salvarPerfil (src/lib/actions/loja.ts:134-145) e o gate de
// montarConsultaGeocoding (src/lib/actions/loja.ts:60) — qualquer adição
// futura de coluna sensível deve quebrar VERMELHO aqui.

import { describe, it, expect } from "vitest";
import {
  montarPatchPerfil,
  montarConsultaGeocoding,
  type DadosPerfil,
} from "./patches-loja";

// Lista EXATA permitida (espelha loja.ts:134-145). Travada propositalmente:
// se a produção ganhar uma coluna sensível, o teste de allowlist abaixo
// continua exigindo SÓ estas chaves e quebra vermelho.
const COLUNAS_PERMITIDAS = [
  "nome",
  "slug",
  "telefone",
  "whatsapp",
  "endereco_rua",
  "endereco_numero",
  "endereco_bairro",
  "endereco_cidade",
  "endereco_estado",
  "endereco_cep",
] as const;

describe("montarPatchPerfil — allowlist RN-7", () => {
  it("inclui apenas as colunas allowlisted presentes no payload", () => {
    const patch = montarPatchPerfil({
      nome: "Pizzaria do Zé",
      slug: "pizzaria-do-ze",
      telefone: "11999990000",
      whatsapp: "11988887777",
      endereco_rua: "Rua das Flores",
      endereco_numero: "123",
      endereco_bairro: "Centro",
      endereco_cidade: "São Paulo",
      endereco_estado: "SP",
      endereco_cep: "01001000",
    });

    expect(patch).toEqual({
      nome: "Pizzaria do Zé",
      slug: "pizzaria-do-ze",
      telefone: "11999990000",
      whatsapp: "11988887777",
      endereco_rua: "Rua das Flores",
      endereco_numero: "123",
      endereco_bairro: "Centro",
      endereco_cidade: "São Paulo",
      endereco_estado: "SP",
      endereco_cep: "01001000",
    });
    // Nenhuma chave fora da allowlist (trava a lista exata).
    expect(Object.keys(patch).sort()).toEqual([...COLUNAS_PERMITIDAS].sort());
  });

  it("inclui só nome e slug quando os opcionais estão ausentes", () => {
    const patch = montarPatchPerfil({
      nome: "Bar do João",
      slug: "bar-do-joao",
    });

    expect(patch).toEqual({ nome: "Bar do João", slug: "bar-do-joao" });
  });

  it("SEGURANÇA RN-7: descarta colunas autoritativas mesmo se vierem no payload", () => {
    // Payload hostil: tenta escalar privilégio / forjar estado de assinatura /
    // injetar coords. NENHUMA dessas chaves pode aparecer no patch.
    const patch = montarPatchPerfil({
      nome: "Loja Maliciosa",
      slug: "loja-maliciosa",
      // chaves autoritativas — devem ser ignoradas:
      dono_id: "00000000-0000-0000-0000-000000000000",
      ativo: true,
      assinatura_status: "ativa",
      hotmart_subscriber_code: "HACK123",
      hotmart_status: "ACTIVE",
      consentimento_lgpd: true,
      consentimento_em: "2026-01-01T00:00:00Z",
      id: "11111111-1111-1111-1111-111111111111",
      latitude: -23.5,
      longitude: -46.6,
      // `as unknown as DadosPerfil`: simula um input FORJADO furando o tipo —
      // a defesa do RN-7 é em runtime (allowlist coluna-a-coluna), não no tipo.
    } as unknown as DadosPerfil);

    expect(patch.dono_id).toBeUndefined();
    expect(patch.ativo).toBeUndefined();
    expect(patch.assinatura_status).toBeUndefined();
    expect(patch.hotmart_subscriber_code).toBeUndefined();
    expect(patch.hotmart_status).toBeUndefined();
    expect(patch.consentimento_lgpd).toBeUndefined();
    expect(patch.consentimento_em).toBeUndefined();
    expect(patch.id).toBeUndefined();
    expect(patch.latitude).toBeUndefined();
    expect(patch.longitude).toBeUndefined();

    // Só as colunas allowlisted de fato presentes.
    expect(patch).toEqual({ nome: "Loja Maliciosa", slug: "loja-maliciosa" });

    // Trava: toda chave do patch pertence à allowlist.
    for (const chave of Object.keys(patch)) {
      expect(COLUNAS_PERMITIDAS).toContain(chave);
    }
  });
});

describe("montarConsultaGeocoding — gate cidade+estado", () => {
  it("monta string rica (específico → genérico) com Brasil ancorado no fim", () => {
    const consulta = montarConsultaGeocoding({
      endereco_rua: "Rua das Flores",
      endereco_numero: "123",
      endereco_bairro: "Centro",
      endereco_cidade: "São Paulo",
      endereco_estado: "SP",
      endereco_cep: "01001000",
    });

    expect(consulta).toBe(
      "Rua das Flores, 123, Centro, São Paulo - SP, 01001000, Brasil",
    );
  });

  it("monta com o mínimo (cidade+estado) quando rua/numero/bairro/cep faltam", () => {
    const consulta = montarConsultaGeocoding({
      endereco_cidade: "Campinas",
      endereco_estado: "SP",
    });

    expect(consulta).toBe("Campinas - SP, Brasil");
  });

  it("retorna null quando falta a cidade (gate de completude)", () => {
    expect(
      montarConsultaGeocoding({ endereco_estado: "SP", endereco_rua: "Rua X" }),
    ).toBeNull();
  });

  it("retorna null quando falta o estado (gate de completude)", () => {
    expect(
      montarConsultaGeocoding({ endereco_cidade: "Campinas" }),
    ).toBeNull();
  });

  it("retorna null quando cidade/estado são strings vazias após trim", () => {
    expect(
      montarConsultaGeocoding({ endereco_cidade: "  ", endereco_estado: "SP" }),
    ).toBeNull();
  });
});

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
  deveRegeocodificar,
  temCoordenadas,
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
  // Issue 122: preferência operacional (NÃO é coluna autoritativa/billing).
  "whatsapp_envio_automatico",
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
      whatsapp_envio_automatico: true,
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
      whatsapp_envio_automatico: true,
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

  // ── Issue 122: flag whatsapp_envio_automatico ──────────────────────────────
  it("inclui whatsapp_envio_automatico quando true", () => {
    const patch = montarPatchPerfil({
      nome: "Bar do João",
      slug: "bar-do-joao",
      whatsapp_envio_automatico: true,
    });

    expect(patch).toEqual({
      nome: "Bar do João",
      slug: "bar-do-joao",
      whatsapp_envio_automatico: true,
    });
  });

  it("inclui whatsapp_envio_automatico quando FALSE (checa !== undefined, não truthiness)", () => {
    const patch = montarPatchPerfil({
      nome: "Bar do João",
      slug: "bar-do-joao",
      whatsapp_envio_automatico: false,
    });

    expect("whatsapp_envio_automatico" in patch).toBe(true);
    expect(patch.whatsapp_envio_automatico).toBe(false);
    expect(patch).toEqual({
      nome: "Bar do João",
      slug: "bar-do-joao",
      whatsapp_envio_automatico: false,
    });
  });

  it("NÃO inclui whatsapp_envio_automatico quando ausente (preserva o valor no banco)", () => {
    const patch = montarPatchPerfil({
      nome: "Bar do João",
      slug: "bar-do-joao",
    });

    expect("whatsapp_envio_automatico" in patch).toBe(false);
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
  it("monta string rica (específico → genérico) com Brasil ancorado no fim, SEM o CEP", () => {
    const consulta = montarConsultaGeocoding({
      endereco_rua: "Rua das Flores",
      endereco_numero: "123",
      endereco_bairro: "Centro",
      endereco_cidade: "São Paulo",
      endereco_estado: "SP",
      endereco_cep: "01001000",
    });

    // [186] O CEP é token ENVENENADOR na busca livre (evidência da 185) e não
    // entra na consulta, mesmo quando presente no endereço da loja.
    expect(consulta).toBe("Rua das Flores, 123, Centro, São Paulo - SP, Brasil");
    expect(consulta).not.toContain("01001000");
  });

  it("[186] CEP em qualquer formato NUNCA aparece na consulta", () => {
    for (const cep of ["01001000", "01001-000", " 12914-190 "]) {
      const consulta = montarConsultaGeocoding({
        endereco_cidade: "Campinas",
        endereco_estado: "SP",
        endereco_cep: cep,
      });

      expect(consulta).toBe("Campinas - SP, Brasil");
    }
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

// ── Issue 180-A: deveRegeocodificar — o 2º UPDATE deixa de ser incondicional ──
// O bug: salvar só o nome da loja com o geocoder fora do ar apagava uma
// localização válida. A comparação sai da MESMA montarConsultaGeocoding dos dois
// lados (D-180A-1) — nenhuma segunda lista de campos de endereço.
describe("deveRegeocodificar — só regeocodifica quando o endereço mudou (180-A)", () => {
  const ENDERECO_LOJA = {
    endereco_cep: "01310-100",
    endereco_rua: "Av. Paulista",
    endereco_numero: "1000",
    endereco_bairro: "Bela Vista",
    endereco_cidade: "São Paulo",
    endereco_estado: "SP",
  };
  const LOJA_COM_COORDS = {
    ...ENDERECO_LOJA,
    latitude: -23.56,
    longitude: -46.65,
  };

  it("endereço idêntico → false (preserva as coords, é o bug da issue)", () => {
    expect(deveRegeocodificar({ ...ENDERECO_LOJA }, LOJA_COM_COORDS)).toBe(false);
  });

  it("idêntico a menos de espaços em volta → false (trim da consulta absorve)", () => {
    expect(
      deveRegeocodificar(
        {
          ...ENDERECO_LOJA,
          endereco_cidade: "  São Paulo ",
          endereco_estado: " SP  ",
          endereco_rua: " Av. Paulista ",
        },
        LOJA_COM_COORDS,
      ),
    ).toBe(false);
  });

  it("[D-180A-1] só o CEP mudou → false: o CEP está fora da consulta (186), o ponto seria o mesmo", () => {
    expect(
      deveRegeocodificar(
        { ...ENDERECO_LOJA, endereco_cep: "99999-999" },
        LOJA_COM_COORDS,
      ),
    ).toBe(false);
  });

  it.each([
    ["endereco_rua", "Rua Augusta"],
    ["endereco_numero", "2000"],
    ["endereco_bairro", "Consolação"],
    ["endereco_cidade", "Campinas"],
    ["endereco_estado", "RJ"],
  ])("%s alterado → true (endereço mudou de fato)", (campo, valor) => {
    expect(
      deveRegeocodificar({ ...ENDERECO_LOJA, [campo]: valor }, LOJA_COM_COORDS),
    ).toBe(true);
  });

  it("endereço completo → incompleto (apagou a cidade) → true; o par vai a NULL (D3)", () => {
    expect(
      deveRegeocodificar(
        { ...ENDERECO_LOJA, endereco_cidade: null },
        LOJA_COM_COORDS,
      ),
    ).toBe(true);
  });

  it("consultas iguais e NULAS, mas a loja tem coords órfãs → true (limpa o par, D3)", () => {
    expect(
      deveRegeocodificar(
        { endereco_cidade: null, endereco_estado: null },
        { endereco_cidade: null, endereco_estado: null, latitude: -23.56, longitude: -46.65 },
      ),
    ).toBe(true);
  });

  it("consultas iguais e NULAS, loja SEM coords → false (nada a limpar, nada a buscar)", () => {
    expect(
      deveRegeocodificar(
        { endereco_cidade: null, endereco_estado: null },
        { endereco_cidade: null, endereco_estado: null, latitude: null, longitude: null },
      ),
    ).toBe(false);
  });

  it("coord órfã pela METADE (só latitude) não conta como par → false", () => {
    expect(
      deveRegeocodificar(
        { endereco_cidade: null, endereco_estado: null },
        { endereco_cidade: null, endereco_estado: null, latitude: -23.56, longitude: null },
      ),
    ).toBe(false);
  });

  it("endereço igual e loja SEM coords (nunca geocodificada) → false", () => {
    expect(
      deveRegeocodificar(
        { ...ENDERECO_LOJA },
        { ...ENDERECO_LOJA, latitude: null, longitude: null },
      ),
    ).toBe(false);
  });

  it("coord órfã pela METADE (só longitude) não conta como par → false", () => {
    // Espelha o caso "só latitude" acima — sem isso, um bug que trocasse
    // latitude↔longitude na checagem de temCoordenadas passaria despercebido.
    expect(
      deveRegeocodificar(
        { endereco_cidade: null, endereco_estado: null },
        { endereco_cidade: null, endereco_estado: null, latitude: null, longitude: -46.65 },
      ),
    ).toBe(false);
  });

  it("endereço incompleto → completo (ganhou cidade+UF) → true, mesmo sem coords prévias", () => {
    // Direção oposta do caso "completo → incompleto" já coberto acima: prova que
    // a regra não é assimétrica (ex.: um bug que só testasse consultaAtual===null
    // passaria a ignorar esta direção).
    expect(
      deveRegeocodificar(
        { ...ENDERECO_LOJA },
        { endereco_cidade: null, endereco_estado: null, latitude: null, longitude: null },
      ),
    ).toBe(true);
  });

  it("row projetada: campos de endereço da loja atual vêm UNDEFINED (não null) com coords gravadas → true (limpa a órfã)", () => {
    // Uma query que projeta só um subconjunto de colunas devolve `undefined`
    // para as que não pediu, nunca `null`. montarConsultaGeocoding trata os dois
    // igual (?.trim()), mas é o comportamento de deveRegeocodificar com esse dado
    // real que este teste trava — undefined não pode "esconder" a coord órfã.
    expect(
      deveRegeocodificar(
        { endereco_cidade: undefined, endereco_estado: undefined },
        { latitude: -23.56, longitude: -46.65 }, // sem nenhuma chave de endereço
      ),
    ).toBe(true);
  });

  it("coords da loja atual UNDEFINED (não null) nas duas colunas → false (não é par, nada a limpar)", () => {
    expect(
      deveRegeocodificar(
        { endereco_cidade: null, endereco_estado: null },
        { endereco_cidade: null, endereco_estado: null }, // latitude/longitude ausentes
      ),
    ).toBe(false);
  });

  it("só um dos pares é UNDEFINED (latitude presente, longitude undefined) → false", () => {
    expect(
      deveRegeocodificar(
        { endereco_cidade: null, endereco_estado: null },
        { endereco_cidade: null, endereco_estado: null, latitude: -23.56 },
      ),
    ).toBe(false);
  });

  it("diferença só de caixa/acento (São Paulo vs Sao paulo) → true: NÃO é normalizada, só espaço é (documenta o limite do D-180A-1)", () => {
    // O comentário de deveRegeocodificar é explícito: só o trim() da consulta é
    // "de graça". Maiúsculas/acentos diferentes produzem strings distintas e
    // disparam regeocodificação — comportamento intencional, não bug. Este teste
    // trava essa decisão: se alguém normalizar caixa/acento no futuro sem querer,
    // ele quebra e obriga a decisão consciente.
    expect(
      deveRegeocodificar(
        { ...ENDERECO_LOJA, endereco_cidade: "Sao paulo" },
        LOJA_COM_COORDS,
      ),
    ).toBe(true);
  });

  it("endereço completo INALTERADO mas coords gravadas pela METADE (só latitude) → false: reparo de par corrompido é FORA do escopo de D3", () => {
    // D3 só limpa coord órfã quando o ENDEREÇO está incompleto. Se o endereço
    // está completo e igual ao anterior, a função não entra no ramo 2 (só chega
    // lá quando consultaNova === null) — logo um par corrompido por outra causa
    // (ex.: escrita direta no banco) sobrevive até o próximo save que MUDE o
    // endereço. Comportamento atual, travado aqui para não ser "corrigido" por
    // engano numa refatoração sem essa decisão consciente.
    expect(
      deveRegeocodificar(
        { ...ENDERECO_LOJA },
        { ...ENDERECO_LOJA, latitude: -23.56, longitude: null },
      ),
    ).toBe(false);
  });
});

describe("temCoordenadas — par tudo-ou-nada, direto (sem passar por deveRegeocodificar)", () => {
  it("ambas presentes → true", () => {
    expect(temCoordenadas({ latitude: -23.56, longitude: -46.65 })).toBe(true);
  });

  it("ambas null → false", () => {
    expect(temCoordenadas({ latitude: null, longitude: null })).toBe(false);
  });

  it("ambas UNDEFINED (row projetada sem as colunas) → false", () => {
    expect(temCoordenadas({})).toBe(false);
  });

  it("só latitude (longitude null) → false", () => {
    expect(temCoordenadas({ latitude: -23.56, longitude: null })).toBe(false);
  });

  it("só longitude (latitude null) → false", () => {
    expect(temCoordenadas({ latitude: null, longitude: -46.65 })).toBe(false);
  });

  it("só latitude (longitude UNDEFINED) → false", () => {
    expect(temCoordenadas({ latitude: -23.56 })).toBe(false);
  });

  it("latitude null, longitude UNDEFINED (mistura dos dois \"vazios\") → false", () => {
    expect(temCoordenadas({ latitude: null, longitude: undefined })).toBe(false);
  });

  it("latitude ZERO (linha do equador) + longitude presente → true: 0 não é falsy aqui (checagem é !== null/undefined, não truthiness)", () => {
    // Guarda contra um bug clássico: `!loja.latitude` trataria 0 como ausente.
    // A implementação usa !== null/undefined, então precisa passar com lat=0.
    expect(temCoordenadas({ latitude: 0, longitude: -46.65 })).toBe(true);
  });
});

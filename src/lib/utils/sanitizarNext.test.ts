import { describe, it, expect } from "vitest";
import { sanitizarNext } from "./sanitizarNext";

/**
 * RN-15 / decisão 21: `next` só caminho interno. Casos novos (P18); o RED do
 * callback já cobre `//evil.com` pela rota. Aqui a regra é provada na unidade,
 * com a checagem que importa: o que sai NUNCA muda de origem quando um
 * navegador resolve o valor (redirect()/router.push usam o parser WHATWG).
 */
const ORIGEM = "https://app.local";
const mesmaOrigem = (path: string) => new URL(path, ORIGEM).origin === ORIGEM;

describe("sanitizarNext — aceita só caminho interno", () => {
  for (const ok of ["/", "/minha-conta", "/loja/pizzaria", "/loja/x?a=1&b=2#topo", "/conta/recuperar?etapa=nova-senha"]) {
    it(`mantém '${ok}' intacto e na mesma origem`, () => {
      expect(sanitizarNext(ok)).toBe(ok);
      expect(mesmaOrigem(ok)).toBe(true);
    });
  }

  for (const [rotulo, v] of [
    ["null", null],
    ["undefined", undefined],
    ["vazio", ""],
    ["relativo sem barra", "loja/x"],
    ["URL absoluta https", "https://evil.com"],
    ["URL absoluta http", "http://evil.com/x"],
    ["protocol-relative", "//evil.com"],
    ["protocol-relative com 3 barras", "///evil.com"],
    ["javascript:", "javascript:alert(1)"],
    ["espaço antes da barra", " /minha-conta"],
    ["data:", "data:text/html,x"],
  ] as const) {
    it(`${rotulo} → undefined`, () => {
      expect(sanitizarNext(v as string | null | undefined)).toBeUndefined();
    });
  }
});

// BUG ENCONTRADO (não corrigido — fora do escopo do testar): o navegador trata
// '\' como '/' em URLs http(s) e descarta \t \n \r dentro da URL. Logo
// "/\evil.com" e "/\t/evil.com" viram "//evil.com" (host externo) ao serem
// resolvidos, mas passam por `sanitizarNext` (começam com '/', não com '//').
// Exploráveis onde o valor sai sem prefixo de origem: `redirect(next)` em
// completarPerfilCliente/sairCliente (cabeçalho Location) e `destino` devolvido
// por entrarCliente/redefinirSenhaCliente (router.push no cliente). Em
// sanitizarNext.ts:8-10. `it.fails` mantém a suíte verde e FALHA quando o bug
// for corrigido (aí remova o `.fails`).
describe("sanitizarNext — bypass por barra invertida / controle (BUG conhecido)", () => {
  for (const [rotulo, v] of [
    ["barra invertida", "/\\evil.com"],
    ["barra + barra invertida", "/\\/evil.com"],
    ["tab entre as barras", "/\t/evil.com"],
    ["newline entre as barras", "/\n/evil.com"],
  ] as const) {
    it(`${rotulo}: resultado nunca muda de origem`, () => {
      const r = sanitizarNext(v);
      // Pré-condição do bug: o valor realmente escaparia da origem.
      expect(mesmaOrigem(v)).toBe(false);
      expect(r === undefined || mesmaOrigem(r)).toBe(true);
    });
  }
});

// Conversões de input de zona de entrega (issue 183) — módulo PURO, sem React,
// testável no `environment: node`: moeda BR → número e CEP mascarado ↔
// inteiro de 8 dígitos (o formato de `taxas_entrega.cep_*`). Desde a issue 325
// também lê as zonas gravadas e monta o payload das telas de faixas de CEP e de
// bairros (`lerFaixasCep`/`montarPayloadCep`, `lerGruposBairro`/
// `montarPayloadBairros`).
//
// O payload montado aqui é só gate de UX: a Server Action revalida com
// `schemaZonasEntrega` e a RPC `salvar_zonas_entrega` é a autoridade final
// (deriva nome, tipo e loja). FORA DAQUI: persistência (Server Actions), match
// de zona por endereço (calcularFrete).
import type { ZodError } from "zod";

import type { ZonaVitrine } from "@/lib/supabase/queries/entregaPagamento";
import { limparCep } from "@/lib/utils/buscarCep";
import { normalizarBairro } from "@/lib/utils/calcularFrete";
import {
  TETO_BAIRROS_POR_GRUPO,
  TETO_FAIXAS_CEP,
  TETO_GRUPOS_BAIRRO,
  schemaFaixasCep,
  schemaGruposBairro,
  type DadosZonasSemVersao,
} from "@/lib/validacoes/entrega";

/** Converte string de moeda BR (vírgula) para número; vazio → null. */
export function paraNumero(valor: string): number | null {
  const limpo = valor.replace(",", ".").trim();
  if (limpo === "") return null;
  const n = Number(limpo);
  return Number.isNaN(n) ? null : n;
}

/** CEP mascarado ("01000-000") → inteiro de 8 dígitos (1000000). Exige 8 dígitos. */
export function cepParaInteiro(cep: string): number | null {
  const digitos = limparCep(cep);
  if (digitos.length !== 8) return null;
  // `Number("01000000") === 1000000`: o zero à esquerda some, e é assim que
  // `calcularFrete` normaliza o CEP do cliente — a comparação fica consistente.
  return Number(digitos);
}

/** Inteiro (1000000) → máscara ("01000-000"), repadronizando o zero à esquerda. */
export function cepInteiroParaMascara(valor: number | null): string {
  if (valor == null) return "";
  const digitos = String(valor).padStart(8, "0");
  return `${digitos.slice(0, 5)}-${digitos.slice(5)}`;
}

// ─── Faixas de CEP (issue 325) ──────────────────────────────────────────────

/**
 * Faixa de CEP como a tela a edita. CEPs mascarados ("01000-000"); `taxa`/
 * `gratis` sem máscara de moeda ("8.5"; vazio = ""); `gratis === null` = sem
 * frete grátis.
 */
export type FaixaCepEditavel = {
  cepInicio: string;
  cepFim: string;
  taxa: string;
  gratis: string | null;
  ativo: boolean;
};

export type PayloadCep = Extract<DadosZonasSemVersao, { forma: "faixa_cep" }>;
export type PayloadBairros = Extract<DadosZonasSemVersao, { forma: "bairro" }>;

/** Resultado de montagem: payload inteiro ou o primeiro erro, com a linha dele. */
export type Montagem<P> = { ok: true; payload: P } | { ok: false; erro: string; indice: number | null };

/** Número do banco → valor sem máscara do input de moeda ("4.5"); `paraNumero` desfaz. */
function moedaParaTexto(valor: number): string {
  return String(valor);
}

/**
 * Zonas gravadas → linhas da tela de CEP. Só entram zonas `faixa_cep` com taxa
 * e os dois CEPs; ordenadas por `cep_inicio`, CEPs mascarados.
 */
export function lerFaixasCep(zonas: ZonaVitrine[]): FaixaCepEditavel[] {
  const linhas: Array<FaixaCepEditavel & { ordem: number }> = [];
  for (const z of zonas) {
    if (z.tipo !== "faixa_cep" || z.taxa == null) continue;
    const { cep_inicio, cep_fim, taxa, pedido_minimo_gratis } = z.taxa;
    if (cep_inicio == null || cep_fim == null) continue;
    linhas.push({
      ordem: cep_inicio,
      cepInicio: cepInteiroParaMascara(cep_inicio),
      cepFim: cepInteiroParaMascara(cep_fim),
      taxa: moedaParaTexto(taxa),
      gratis: pedido_minimo_gratis == null ? null : moedaParaTexto(pedido_minimo_gratis),
      ativo: z.ativo,
    });
  }
  return linhas.sort((a, b) => a.ordem - b.ordem).map(({ ordem: _ordem, ...linha }) => linha);
}

const AJUDA_VALOR = "use valor de R$ 0,00 para cima, com até 2 casas decimais.";

/** Primeira issue do zod → índice da linha (path[1]) e campo (path[2]). */
function primeiraIssue(erro: ZodError): {
  issue: ZodError["issues"][number] | undefined;
  indice: number | null;
  campo: unknown;
} {
  const issue = erro.issues[0];
  const [, indice, campo] = issue?.path ?? [];
  return { issue, indice: typeof indice === "number" ? indice : null, campo };
}

/**
 * Linhas da tela → payload `{ forma: "faixa_cep", faixas }` com CEPs inteiros.
 * Nunca devolve payload pela metade: a primeira linha incompleta ou inválida
 * devolve o erro com o índice dela, para a tela marcar a linha.
 */
export function montarPayloadCep(linhas: FaixaCepEditavel[]): Montagem<PayloadCep> {
  if (linhas.length > TETO_FAIXAS_CEP) {
    return { ok: false, erro: `Cadastre no máximo ${TETO_FAIXAS_CEP} faixas de CEP.`, indice: null };
  }
  const faixas: PayloadCep["faixas"] = [];
  for (const [i, l] of linhas.entries()) {
    const n = i + 1;
    const cepInicio = cepParaInteiro(l.cepInicio);
    if (cepInicio == null) return { ok: false, erro: `Informe o CEP inicial completo da linha ${n}.`, indice: i };
    const cepFim = cepParaInteiro(l.cepFim);
    if (cepFim == null) return { ok: false, erro: `Informe o CEP final completo da linha ${n}.`, indice: i };
    const faixa = `de ${l.cepInicio} a ${l.cepFim}`;
    const taxa = paraNumero(l.taxa);
    if (taxa == null) return { ok: false, erro: `Informe o preço da faixa ${faixa}.`, indice: i };
    let gratis: number | null = null;
    if (l.gratis !== null) {
      gratis = paraNumero(l.gratis);
      if (gratis == null) {
        return {
          ok: false,
          erro: `Informe o valor do frete grátis da faixa ${faixa} ou desligue a opção.`,
          indice: i,
        };
      }
    }
    faixas.push({ cep_inicio: cepInicio, cep_fim: cepFim, taxa, pedido_minimo_gratis: gratis, ativo: l.ativo });
  }

  const parsed = schemaFaixasCep.safeParse({ faixas });
  if (parsed.success) return { ok: true, payload: { forma: "faixa_cep", ...parsed.data } };

  const { issue, indice, campo } = primeiraIssue(parsed.error);
  // Invertida e sobreposta: a mensagem do zod já cita os CEPs.
  if (issue?.code === "custom") return { ok: false, erro: issue.message, indice };
  if (indice != null) {
    const l = linhas[indice];
    const oQue = campo === "pedido_minimo_gratis" ? "o frete grátis" : "o preço";
    return { ok: false, erro: `Confira ${oQue} da faixa de ${l.cepInicio} a ${l.cepFim}: ${AJUDA_VALOR}`, indice };
  }
  return { ok: false, erro: "Confira as faixas de CEP.", indice: null };
}

// ─── Grupos de bairros (issue 325) ──────────────────────────────────────────

/**
 * Grupo de bairros como a tela o edita: um preço para vários bairros.
 * `novoBairro` é o rascunho do campo de adicionar (nunca vai no payload).
 */
export type GrupoBairroEditavel = {
  bairros: string[];
  novoBairro: string;
  taxa: string;
  gratis: string | null;
  ativo: boolean;
};

/** Zonas gravadas → grupos da tela: cada zona `bairro` com taxa vira um grupo. */
export function lerGruposBairro(zonas: ZonaVitrine[]): GrupoBairroEditavel[] {
  return zonas
    .filter((z) => z.tipo === "bairro" && z.taxa != null)
    .map((z) => ({
      bairros: z.bairros.map((b) => b.nome),
      novoBairro: "",
      taxa: moedaParaTexto(z.taxa!.taxa),
      gratis: z.taxa!.pedido_minimo_gratis == null ? null : moedaParaTexto(z.taxa!.pedido_minimo_gratis),
      ativo: z.ativo,
    }));
}

/**
 * Índice do grupo que já tem este bairro, pela MESMA normalização da vitrine
 * (`normalizarBairro`: caixa, acento e espaço não contam); `null` se não há.
 */
export function grupoComBairro(grupos: ReadonlyArray<{ bairros: string[] }>, bairro: string): number | null {
  const alvo = normalizarBairro(bairro);
  const i = grupos.findIndex((g) => g.bairros.some((b) => normalizarBairro(b) === alvo));
  return i === -1 ? null : i;
}

/**
 * Grupos da tela → payload `{ forma: "bairro", grupos }`. Grupo sem bairro,
 * preço vazio ou bairro repetido devolve o erro com o índice do grupo.
 */
export function montarPayloadBairros(grupos: GrupoBairroEditavel[]): Montagem<PayloadBairros> {
  if (grupos.length > TETO_GRUPOS_BAIRRO) {
    return { ok: false, erro: `Cadastre no máximo ${TETO_GRUPOS_BAIRRO} preços por bairro.`, indice: null };
  }
  const itens: PayloadBairros["grupos"] = [];
  for (const [i, g] of grupos.entries()) {
    if (g.bairros.length === 0) return { ok: false, erro: "Adicione pelo menos um bairro a este preço.", indice: i };
    const taxa = paraNumero(g.taxa);
    if (taxa == null) return { ok: false, erro: "Informe o preço destes bairros.", indice: i };
    let gratis: number | null = null;
    if (g.gratis !== null) {
      gratis = paraNumero(g.gratis);
      if (gratis == null) {
        return { ok: false, erro: "Informe o valor do frete grátis destes bairros ou desligue a opção.", indice: i };
      }
    }
    itens.push({ bairros: g.bairros, taxa, pedido_minimo_gratis: gratis, ativo: g.ativo });
  }

  const parsed = schemaGruposBairro.safeParse({ grupos: itens });
  if (parsed.success) return { ok: true, payload: { forma: "bairro", ...parsed.data } };

  const { issue, indice, campo } = primeiraIssue(parsed.error);
  // Bairro repetido, teto total e grupo sem bairro: a mensagem do zod é a da tela.
  if (issue?.code === "custom") return { ok: false, erro: issue.message, indice };
  if (indice != null && (campo === "taxa" || campo === "pedido_minimo_gratis")) {
    const oQue = campo === "pedido_minimo_gratis" ? "o frete grátis" : "o preço";
    return { ok: false, erro: `Confira ${oQue} destes bairros: ${AJUDA_VALOR}`, indice };
  }
  if (indice != null && campo === "bairros") {
    return {
      ok: false,
      erro: `Cadastre até ${TETO_BAIRROS_POR_GRUPO} bairros por preço, com nomes de até 120 letras.`,
      indice,
    };
  }
  return { ok: false, erro: "Confira os preços por bairro.", indice };
}

// Estado das telas de zona de entrega ↔ payload — módulo PURO, sem React,
// testável no `environment: node`. Converte input (moeda BR → número, CEP
// mascarado ↔ inteiro de 8 dígitos, o formato de `taxas_entrega.cep_*`), lê as
// zonas gravadas de cada forma para o estado editável e monta o payload da
// forma: faixas de km (`montarPayloadKm`), faixas de CEP
// (`lerFaixasCep`/`montarPayloadCep`) e bairros (`lerGruposBairro`/
// `montarPayloadBairros`). Cada montagem devolve o payload inteiro ou o
// primeiro erro com a linha dele (`Montagem`); `chaveDaMontagem` dá a chave
// usada para não regravar o mesmo payload.
//
// O payload montado aqui é só gate de UX: a Server Action revalida com
// `schemaZonasEntrega` e a RPC `salvar_zonas_entrega` é a autoridade final
// (deriva nome, tipo e loja). FORA DAQUI: persistência (Server Actions), match
// de zona por endereço (calcularFrete).
import type { ZodError } from "zod";

import type { ZonaVitrine } from "@/lib/supabase/queries/entregaPagamento";
import { limparCep } from "@/lib/utils/buscarCep";
import { normalizarBairro } from "@/lib/utils/calcularFrete";
import { rotuloFaixa, type IncrementoFaixa } from "@/lib/utils/faixasEntrega";
import {
  MENSAGEM_FAIXA_ATIVA_DEPOIS_DE_DESLIGADA,
  TETO_BAIRROS_POR_GRUPO,
  TETO_FAIXAS_CEP,
  TETO_GRUPOS_BAIRRO,
  schemaFaixasCep,
  schemaFaixasEntrega,
  schemaGruposBairro,
  type DadosFaixasEntrega,
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

/** Resultado de montagem: payload inteiro ou o primeiro erro, com a linha dele. */
export type Montagem<P> = { ok: true; payload: P } | { ok: false; erro: string; indice: number | null };

/** Número do banco → valor sem máscara do input de moeda ("4.5"); `paraNumero` desfaz. */
export function moedaParaTexto(valor: number): string {
  return String(valor);
}

/** Chave de "não regravar o mesmo payload": o payload montado, ou null se não monta. */
export function chaveDaMontagem<P>(montagem: Montagem<P>): string | null {
  return montagem.ok ? JSON.stringify(montagem.payload) : null;
}

// ─── Faixas de km (issue 326) ───────────────────────────────────────────────

/**
 * Faixa de km como a tela a edita. `taxa`/`gratis` são o valor SEM máscara do
 * `IMaskInput` ("8.5"; vazio = ""); `gratis === null` = sem frete grátis.
 */
export type FaixaEditavel = { taxa: string; gratis: string | null; ativo: boolean };

const AJUDA_VALOR = "use valor de R$ 0,00 para cima, com até 2 casas decimais.";

/**
 * Estado da tela → payload de km (sem `forma`; o editor acrescenta).
 * `schemaFaixasEntrega` aqui é só gate de UX: a Server Action revalida e a RPC
 * rederiva teto/nome/tipo. Nunca devolve payload pela metade: a primeira faixa
 * com preço (ou frete grátis ligado) vazio ou inválido devolve o erro com o
 * índice dela, para a tela marcar a linha.
 */
export function montarPayloadKm(
  incremento: IncrementoFaixa,
  faixas: FaixaEditavel[],
): Montagem<DadosFaixasEntrega> {
  const itens: DadosFaixasEntrega["faixas"] = [];
  for (const [i, f] of faixas.entries()) {
    const rotulo = rotuloFaixa(i, incremento);
    const taxa = paraNumero(f.taxa);
    if (taxa == null) return { ok: false, erro: `Informe o preço da faixa de ${rotulo}.`, indice: i };
    let gratis: number | null = null;
    if (f.gratis !== null) {
      gratis = paraNumero(f.gratis);
      if (gratis == null) {
        return {
          ok: false,
          erro: `Informe o valor do frete grátis da faixa de ${rotulo} ou desligue a opção.`,
          indice: i,
        };
      }
    }
    itens.push({ taxa, pedido_minimo_gratis: gratis, ativo: f.ativo });
  }

  const parsed = schemaFaixasEntrega.safeParse({ incremento, faixas: itens });
  if (parsed.success) return { ok: true, payload: parsed.data };

  const { indice, campo } = primeiraIssue(parsed.error);
  if (indice != null) {
    if (campo === "ativo") {
      return { ok: false, erro: MENSAGEM_FAIXA_ATIVA_DEPOIS_DE_DESLIGADA, indice };
    }
    const oQue = campo === "pedido_minimo_gratis" ? "o frete grátis" : "o preço";
    return { ok: false, erro: `Confira ${oQue} da faixa de ${rotuloFaixa(indice, incremento)}: ${AJUDA_VALOR}`, indice };
  }
  return { ok: false, erro: "Confira as faixas de entrega.", indice: null };
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
  return zonas.flatMap((z) => {
    if (z.tipo !== "bairro" || z.taxa == null) return [];
    const { taxa, pedido_minimo_gratis } = z.taxa;
    return [
      {
        bairros: z.bairros.map((b) => b.nome),
        novoBairro: "",
        taxa: moedaParaTexto(taxa),
        gratis: pedido_minimo_gratis == null ? null : moedaParaTexto(pedido_minimo_gratis),
        ativo: z.ativo,
      },
    ];
  });
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
    if (g.bairros.some((b) => b.trim() === "")) {
      return { ok: false, erro: "Preencha o nome de cada bairro deste preço.", indice: i };
    }
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

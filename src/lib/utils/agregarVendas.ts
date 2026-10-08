// Rollup do relatório de vendas (issue 357). Função PURA, sem I/O. Os valores
// de entrada são AUTORITATIVOS: saem das funções SQL `vendas_por_dia` e
// `vendas_itens_por_categoria`, que somam em `numeric` o que o checkout gravou.
// Aqui só se REAGRUPA linhas diárias em semana/ciclo, arredondando a centavo a
// cada soma (`arredondar`), para que Σ diário = Σ semanal = Σ ciclo (RN-V12).
// Nenhum valor monetário é derivado de outro neste módulo.
// Plano: plan/tecnico-relatorio-vendas.md §7.4.

import { arredondar } from "./arredondar";
import {
  cicloQueContem,
  inicioDaSemanaIso,
  rotuloDia,
  rotuloIntervalo,
  somarDias,
} from "./periodoVendas";
import type { DiaLocal, IntervaloDias } from "@/lib/vendas/tipos";
import type { LinhaItemCategoria } from "@/lib/supabase/queries/vendas";

export type TotaisVendas = {
  pedidos: number;
  bruto: number;
  descontos: number;
  liquido: number;
  frete: number;
  freteACombinar: number;
};
export type LinhaDiariaVendas = TotaisVendas & { dia: DiaLocal };
/** `chave` = primeiro dia do balde. */
export type BarraVendas = TotaisVendas & { chave: DiaLocal; rotulo: string };
export type CategoriaVendas = {
  categoriaId: string | null;
  nome: string;
  quantidade: number;
  valorBruto: number;
  itens: { nome: string; quantidade: number; valorBruto: number }[];
};

export const ROTULO_SEM_CATEGORIA = "Sem categoria";

const ZERO: TotaisVendas = {
  pedidos: 0,
  bruto: 0,
  descontos: 0,
  liquido: 0,
  frete: 0,
  freteACombinar: 0,
};

function somar(a: TotaisVendas, b: TotaisVendas): TotaisVendas {
  return {
    pedidos: a.pedidos + b.pedidos,
    bruto: arredondar(a.bruto + b.bruto),
    descontos: arredondar(a.descontos + b.descontos),
    liquido: arredondar(a.liquido + b.liquido),
    frete: arredondar(a.frete + b.frete),
    freteACombinar: a.freteACombinar + b.freteACombinar,
  };
}

/** Soma só as métricas (chaves extras como `dia`/`chave` são descartadas). */
export function somarLinhas(linhas: readonly TotaisVendas[]): TotaisVendas {
  return linhas.reduce<TotaisVendas>(somar, ZERO);
}

/**
 * Um registro por dia de `i`, em ordem; dia sem venda vem zerado. Linha fora do
 * intervalo é erro de montagem (a faixa do SQL e a do calendário divergiram).
 */
export function preencherDias(linhas: LinhaDiariaVendas[], i: IntervaloDias): LinhaDiariaVendas[] {
  const porDia = new Map<DiaLocal, LinhaDiariaVendas>();
  for (const l of linhas) {
    if (l.dia < i.deDia || l.dia > i.ateDia) {
      throw new Error("Linha de vendas fora do intervalo do relatório");
    }
    porDia.set(l.dia, l);
  }
  const out: LinhaDiariaVendas[] = [];
  for (let dia = i.deDia; dia <= i.ateDia; dia = somarDias(dia, 1)) {
    out.push(porDia.get(dia) ?? { dia, ...ZERO });
  }
  return out;
}

export function barrasDiarias(linhas: LinhaDiariaVendas[]): BarraVendas[] {
  return linhas.map((l) => ({ ...somar(ZERO, l), chave: l.dia, rotulo: rotuloDia(l.dia) }));
}

/** Agrupa linhas (já em ordem de dia) no balde que `baldeDe` devolve. */
function agrupar(linhas: LinhaDiariaVendas[], baldeDe: (dia: DiaLocal) => IntervaloDias): BarraVendas[] {
  const baldes = new Map<DiaLocal, BarraVendas>();
  for (const l of linhas) {
    const balde = baldeDe(l.dia);
    const atual = baldes.get(balde.deDia);
    baldes.set(
      balde.deDia,
      atual
        ? { ...somar(atual, l), chave: atual.chave, rotulo: atual.rotulo }
        : { ...somar(ZERO, l), chave: balde.deDia, rotulo: rotuloIntervalo(balde) },
    );
  }
  return [...baldes.values()];
}

/** Semana ISO (segunda a domingo), RN-V11. */
export function agruparPorSemana(linhas: LinhaDiariaVendas[]): BarraVendas[] {
  return agrupar(linhas, (dia) => {
    const segunda = inicioDaSemanaIso(dia);
    return { deDia: segunda, ateDia: somarDias(segunda, 6) };
  });
}

/** Ciclo mensal da loja (RN-V07); o rótulo é o do ciclo inteiro. */
export function agruparPorCiclo(linhas: LinhaDiariaVendas[], diaInicioCiclo: number): BarraVendas[] {
  return agrupar(linhas, (dia) => cicloQueContem(dia, diaInicioCiclo));
}

/**
 * Agrupa as linhas de `vendas_itens_por_categoria` por categoria, preservando a
 * ordem do SQL. Os totais da categoria são as colunas de janela do SQL (não uma
 * soma em TS). Categoria NULL vira "Sem categoria" e fica por último.
 */
export function agruparItensPorCategoria(linhas: LinhaItemCategoria[]): CategoriaVendas[] {
  const grupos = new Map<string, CategoriaVendas>();
  for (const l of linhas) {
    const chave = l.categoria_id == null ? "" : `${l.categoria_id}|${l.categoria_nome ?? ""}`;
    let grupo = grupos.get(chave);
    if (grupo == null) {
      grupo = {
        categoriaId: l.categoria_id,
        nome: l.categoria_id == null ? ROTULO_SEM_CATEGORIA : (l.categoria_nome ?? ROTULO_SEM_CATEGORIA),
        quantidade: Number(l.categoria_quantidade),
        valorBruto: Number(l.categoria_valor_bruto),
        itens: [],
      };
      grupos.set(chave, grupo);
    }
    grupo.itens.push({
      nome: l.item_nome,
      quantidade: Number(l.quantidade),
      valorBruto: Number(l.valor_bruto),
    });
  }
  const todas = [...grupos.values()];
  return [...todas.filter((c) => c.categoriaId != null), ...todas.filter((c) => c.categoriaId == null)];
}

import type { ReactElement } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  hrefVendas,
  type FiltrosRanking,
  type FiltrosVendas as Filtros,
} from "@/lib/validacoes/vendas";
import type { PresetVendas, TipoEntregaFiltro } from "@/lib/vendas/tipos";

const PRESETS: { valor: Exclude<PresetVendas, "personalizado">; rotulo: string }[] = [
  { valor: "hoje", rotulo: "Hoje" },
  { valor: "semana", rotulo: "Esta semana" },
  { valor: "mes", rotulo: "Este mês" },
  { valor: "mes_anterior", rotulo: "Mês anterior" },
  { valor: "ano", rotulo: "Este ano" },
];

const ENTREGAS: { valor: TipoEntregaFiltro; rotulo: string }[] = [
  { valor: "ambos", rotulo: "Ambos" },
  { valor: "entrega", rotulo: "Entrega" },
  { valor: "retirada", rotulo: "No local" },
];

const ALVO = "min-h-[44px]";

function LinkFiltro({ href, ativo, children }: { href: string; ativo: boolean; children: string }) {
  return (
    <Button
      size="sm"
      variant={ativo ? "default" : "outline"}
      className={ALVO}
      aria-current={ativo ? "true" : undefined}
      nativeButton={false}
      render={<Link href={href} />}
    >
      {children}
    </Button>
  );
}

/**
 * Filtros do relatório (D10): só escrevem a URL. Presets, tipo de entrega e
 * "só concluídos" são links montados no servidor por `hrefVendas` (preservam os
 * demais filtros e o período do ranking); o personalizado é um form GET. O
 * servidor revalida tudo com `lerParamsVendas` antes de consultar.
 */
export function FiltrosVendas({
  baseVendas,
  filtros,
  ranking,
  avisoFiltros,
}: {
  baseVendas: string;
  filtros: Filtros;
  ranking: FiltrosRanking | null;
  avisoFiltros: boolean;
}): ReactElement {
  // Campos ocultos do form personalizado = os mesmos parâmetros que os links
  // escrevem (fonte única: hrefVendas), menos o período, que o form define.
  const ocultos = [
    ...new URL(
      hrefVendas(baseVendas, { ...filtros, periodo: "mes", de: null, ate: null }, ranking),
      "http://base.local",
    ).searchParams.entries(),
  ];

  return (
    <div className="flex flex-col gap-4">
      {avisoFiltros && (
        <p role="status" className="text-sm text-muted-foreground">
          Filtro inválido no endereço. Mostrando o ciclo atual.
        </p>
      )}

      <nav aria-label="Período" className="flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <LinkFiltro
            key={p.valor}
            href={hrefVendas(baseVendas, { ...filtros, periodo: p.valor, de: null, ate: null }, ranking)}
            ativo={filtros.periodo === p.valor}
          >
            {p.rotulo}
          </LinkFiltro>
        ))}
      </nav>

      <form method="get" action={baseVendas} className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="periodo" value="personalizado" />
        {ocultos.map(([nome, valor]) => (
          <input key={nome} type="hidden" name={nome} value={valor} />
        ))}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="vendas-de">De</Label>
          <Input
            id="vendas-de"
            name="de"
            type="date"
            required
            defaultValue={filtros.de ?? undefined}
            className="min-h-[44px] w-auto"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="vendas-ate">Até</Label>
          <Input
            id="vendas-ate"
            name="ate"
            type="date"
            required
            defaultValue={filtros.ate ?? undefined}
            className="min-h-[44px] w-auto"
          />
        </div>
        <Button
          type="submit"
          size="sm"
          variant={filtros.periodo === "personalizado" ? "default" : "outline"}
          className={ALVO}
        >
          Ver período
        </Button>
      </form>

      <div className="flex flex-wrap gap-4">
        <nav aria-label="Tipo de entrega" className="flex flex-wrap gap-2">
          {ENTREGAS.map((e) => (
            <LinkFiltro
              key={e.valor}
              href={hrefVendas(baseVendas, { ...filtros, entrega: e.valor }, ranking)}
              ativo={filtros.entrega === e.valor}
            >
              {e.rotulo}
            </LinkFiltro>
          ))}
        </nav>
        <nav aria-label="Status dos pedidos" className="flex flex-wrap gap-2">
          <LinkFiltro
            href={hrefVendas(baseVendas, { ...filtros, concluidos: !filtros.concluidos }, ranking)}
            ativo={filtros.concluidos}
          >
            Só concluídos
          </LinkFiltro>
        </nav>
      </div>
    </div>
  );
}

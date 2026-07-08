"use client"

import { ChefHat, FileText, Printer, Receipt, type LucideIcon } from "lucide-react"

import type { VarianteImpressao } from "@/lib/utils/variantesHabilitadas"
import { Button } from "@/components/ui/button"
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuPortal,
  MenuPositioner,
  MenuTrigger,
} from "@/components/ui/menu"

/**
 * Seletor de impressão do pedido (issue 132). Client Component: só reage ao
 * GESTO do lojista. Recebe as `variantes` JÁ decididas no servidor (issue 130)
 * — nenhum entitlement é decidido aqui.
 *
 * RN-P3: ao selecionar, grava a variante ativa em `data-print-variant` no
 * <html> e chama `window.print()` síncrono; limpa o atributo no `afterprint`.
 * As regras `@media print` (issue 138) reagem a esse atributo.
 * RN-P5: `window.print()` NUNCA em `useEffect`/mount — apenas no clique.
 */

type RotuloVariante = { readonly rotulo: string; readonly Icone: LucideIcon }

// Rótulos PT fixos por variante (union fechado → sem superfície XSS no atributo).
const ROTULOS: Record<VarianteImpressao, RotuloVariante> = {
  a4: { rotulo: "Comum (A4)", Icone: FileText },
  cozinha: { rotulo: "Via da cozinha", Icone: ChefHat },
  recibo: { rotulo: "Recibo do cliente", Icone: Receipt },
}

/**
 * Grava a variante ativa no <html> e dispara a impressão. Exportada para teste
 * unitário direto (o ambiente vitest é `node`, sem simulação de clique).
 * Só é chamada dentro de handlers de clique — nunca no mount (RN-P5).
 */
export function dispararImpressao(variante: VarianteImpressao): void {
  const raiz = document.documentElement
  raiz.dataset.printVariant = variante
  window.addEventListener(
    "afterprint",
    () => {
      delete raiz.dataset.printVariant
    },
    { once: true }
  )
  window.print()
}

export function SeletorImprimirPedido({
  variantes,
}: {
  variantes: VarianteImpressao[]
}) {
  if (variantes.length === 0) {
    return null
  }

  // Uma única variante habilitada: sem menu, botão direto que já imprime.
  if (variantes.length === 1) {
    const [unica] = variantes
    return (
      <div className="no-print">
        <Button variant="outline" onClick={() => dispararImpressao(unica)}>
          <Printer aria-hidden className="size-4" />
          {ROTULOS[unica].rotulo}
        </Button>
      </div>
    )
  }

  return (
    <div className="no-print">
      <Menu>
        <MenuTrigger render={<Button variant="outline" />}>
          <Printer aria-hidden className="size-4" />
          Imprimir
        </MenuTrigger>
        <MenuPortal>
          <MenuPositioner>
            <MenuPopup>
              {variantes.map((variante) => {
                const { rotulo, Icone } = ROTULOS[variante]
                return (
                  <MenuItem
                    key={variante}
                    className="min-h-11"
                    onClick={() => dispararImpressao(variante)}
                  >
                    <Icone
                      aria-hidden
                      className="size-4 text-muted-foreground"
                    />
                    {rotulo}
                  </MenuItem>
                )
              })}
            </MenuPopup>
          </MenuPositioner>
        </MenuPortal>
      </Menu>
    </div>
  )
}

/**
 * Testes do SeletorImprimirPedido (issue 132).
 *
 * Ambiente: vitest environment=node — sem jsdom/testing-library. Não há
 * simulação de clique; a lógica imperativa de impressão vive em
 * `dispararImpressao`, testada direto com globais stubbados (mock de
 * `window.print`). O render (renderToStaticMarkup) cobre a degradação
 * 1-variante e serve de guarda RN-P5: como `window` fica indefinido no
 * ambiente node, qualquer chamada a `window.print()` em tempo de render
 * lançaria e quebraria o teste — print só é válido no gesto de clique.
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"

import {
  SeletorImprimirPedido,
  dispararImpressao,
} from "./SeletorImprimirPedido"

describe("dispararImpressao", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("grava data-print-variant no <html>, chama window.print e limpa no afterprint", () => {
    const dataset: Record<string, string | undefined> = {}
    const print = vi.fn()
    let afterprint: (() => void) | undefined
    let onceOpts: AddEventListenerOptions | undefined

    vi.stubGlobal("document", { documentElement: { dataset } })
    vi.stubGlobal("window", {
      print,
      addEventListener: (
        evento: string,
        handler: () => void,
        opts?: AddEventListenerOptions
      ) => {
        if (evento === "afterprint") {
          afterprint = handler
          onceOpts = opts
        }
      },
    })

    dispararImpressao("cozinha")

    expect(dataset.printVariant).toBe("cozinha")
    expect(print).toHaveBeenCalledTimes(1)
    expect(onceOpts).toEqual({ once: true })

    // afterprint remove o atributo (não deixa o <html> "preso" numa variante).
    afterprint?.()
    expect(dataset.printVariant).toBeUndefined()
  })

  it("propaga cada variante do union fielmente ao atributo", () => {
    for (const variante of ["a4", "cozinha", "recibo"] as const) {
      const dataset: Record<string, string | undefined> = {}
      vi.stubGlobal("document", { documentElement: { dataset } })
      vi.stubGlobal("window", { print: vi.fn(), addEventListener: vi.fn() })

      dispararImpressao(variante)

      expect(dataset.printVariant).toBe(variante)
      vi.unstubAllGlobals()
    }
  })
})

describe("SeletorImprimirPedido (render)", () => {
  it("1 variante → botão simples com o rótulo daquela variante, sem menu", () => {
    const html = renderToStaticMarkup(
      <SeletorImprimirPedido variantes={["cozinha"]} />
    )

    expect(html).toContain("Via da cozinha")
    // Degrada para botão direto: não há o trigger genérico "Imprimir".
    expect(html).not.toContain("Imprimir")
  })

  it("2+ variantes → trigger único 'Imprimir' (itens ficam no popup/portal)", () => {
    const html = renderToStaticMarkup(
      <SeletorImprimirPedido variantes={["a4", "cozinha", "recibo"]} />
    )

    expect(html).toContain("Imprimir")
  })

  it("nenhuma variante → não renderiza nada", () => {
    const html = renderToStaticMarkup(<SeletorImprimirPedido variantes={[]} />)

    expect(html).toBe("")
  })
})

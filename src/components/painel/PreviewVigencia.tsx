"use client";

import { useEffect, useState } from "react";

const DEBOUNCE_MS = 400;

type PreviewVigenciaProps = {
  /**
   * A frase já pronta, vinda de `descreverVigencia` (M6). Este componente
   * NUNCA a escreve: se a redação nascesse aqui, ela divergiria da vitrine e
   * nenhum teste deste repo pegaria (seriam duas strings em dois `.tsx`).
   */
  frase: string;
  /** `lojas.timezone` nomeado em texto — design §9.4 item 4. */
  fusoRotulo: string;
  /**
   * `Agora (sáb, 19/09, 13:04): APARECENDO`, derivada do SERVIDOR e só para a
   * configuração SALVA (design §9.4 item 3). Enquanto o lojista edita, some:
   * um "está aparecendo agora" calculado no browser mentiria em qualquer
   * dispositivo com o relógio adiantado.
   */
  linhaAgora?: string | null;
};

/**
 * [259] A prévia em linguagem natural — APRESENTAÇÃO PURA.
 *
 * Não tem uma linha de aritmética de data: não importa `Date`, não importa
 * `Intl`, não importa `fusoLoja`. Recebe strings e as pinta. A frase é a
 * interface do formulário; a autoridade da janela continua sendo a função pura
 * no servidor (RN-06).
 *
 * `aria-live="polite"` com debounce de ~400ms (design §9.4 item 2): sem ele,
 * cada clique num toggle de dia reanuncia a frase inteira e o leitor de tela
 * fica ininterrupto. A frase VISÍVEL muda na hora — quem espera é só o
 * anúncio, numa região dedicada.
 */
export function PreviewVigencia({
  frase,
  fusoRotulo,
  linhaAgora,
}: PreviewVigenciaProps) {
  const [anunciada, setAnunciada] = useState(frase);

  useEffect(() => {
    const id = setTimeout(() => setAnunciada(frase), DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [frase]);

  return (
    <section
      aria-labelledby="previa-vigencia-titulo"
      className="rounded-lg border bg-muted/40 p-4"
    >
      <h3
        id="previa-vigencia-titulo"
        className="text-xs font-semibold tracking-wide text-texto-muted uppercase"
      >
        Prévia
      </h3>

      <p className="mt-2 text-base font-semibold" aria-hidden>
        {frase}
      </p>
      {/* A região que fala. Fora do fluxo visual para não duplicar a frase. */}
      <p aria-live="polite" className="sr-only">
        {anunciada}
      </p>

      <p className="mt-1 text-xs text-texto-muted">
        Fuso da loja: {fusoRotulo}
      </p>

      {linhaAgora ? (
        <p className="mt-3 border-t pt-3 text-sm font-medium">{linhaAgora}</p>
      ) : null}
    </section>
  );
}

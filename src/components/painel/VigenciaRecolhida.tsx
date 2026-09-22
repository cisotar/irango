"use client";

import type { ReactElement } from "react";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Card, CardContent } from "@/components/ui/card";
import {
  FormVigencia,
  type FormVigenciaProps,
} from "@/components/painel/FormVigencia";

/** A régua de `design-system.md` §5: valor LITERAL, nunca `min-h-11`. */
const ALVO = "min-h-[44px]";

export type VigenciaRecolhidaProps = FormVigenciaProps & {
  /**
   * A frase de vigência de UMA linha, redigida no SERVIDOR
   * (`descreverVigencia`, com o fuso da loja). É o que o lojista lê sem abrir a
   * seção — o browser nunca redige janela de vigência.
   */
  resumo: string;
};

/**
 * [288/D1] A vigência recolhida no topo do detalhe do cardápio.
 *
 * O `FormVigencia` entra INTEIRO e INALTERADO: a queixa era de arquitetura de
 * tela (sete controles e uma prévia sempre abertos empurrando o objeto da
 * página para baixo), não do formulário. Aqui ele só passa a viver dentro de
 * uma sanfona que nasce FECHADA, com o resumo do servidor na linha do gatilho.
 *
 * `Accordion` é o do Base UI (não Radix): a abertura inicial se declara por
 * `defaultValue` — `[]` é "nenhum item aberto" —, e `keepMounted` mantém o
 * conteúdo no DOM para que o SSR seja afirmável sem jsdom.
 *
 * O bloco é um `Card` branco: `design-system.md` §10.2 regra 4 — não existe
 * bloco de conteúdo do painel fora de card.
 */
export function VigenciaRecolhida({
  resumo,
  ...form
}: VigenciaRecolhidaProps): ReactElement {
  return (
    <Accordion defaultValue={[]}>
      <AccordionItem value="vigencia" className="not-last:border-b-0">
        <Card>
          <CardContent className="py-0">
            <AccordionTrigger
              className={`${ALVO} font-heading text-base font-semibold text-foreground`}
            >
              <span className="flex min-w-0 flex-col text-left">
                Quando este cardápio aparece
                <span className="truncate text-xs font-normal text-texto-muted">
                  {resumo}
                </span>
              </span>
            </AccordionTrigger>
          </CardContent>

          <AccordionContent keepMounted className="pt-0 pb-0">
            <CardContent>
              <FormVigencia {...form} />
            </CardContent>
          </AccordionContent>
        </Card>
      </AccordionItem>
    </Accordion>
  );
}

// [197] Link "Abrir no Google Maps" da tela de CONFIRMAÇÃO (RN-R6).
//
// Apresentacional e puro: recebe as colunas de endereço da loja e monta o href
// internamente, por `montarHrefMapsLoja`. Receber um href pronto de fora
// permitiria à página passar uma URL forjada — a origem literal fica trancada
// num único lugar.
//
// Extraído de `confirmacao/page.tsx` porque a página é Server Component `async`
// e não é alcançável por `renderToStaticMarkup`; aqui `target`/`rel`/`href`
// ficam mecanicamente testáveis.
//
// 🔴 `rel="noopener noreferrer"`: `noopener` evita reverse tabnabbing (regressão
// da issue 126) e `noreferrer` impede que o header `Referer` entregue ao Google
// a URL da confirmação, que carrega o `token_acesso` na query.
//
// Sem âncora geográfica (cidade E estado), `montarHrefMapsLoja` devolve `null` e
// nada é renderizado (RN-R5) — link de busca vazia levaria o cliente a uma tela
// inútil do Maps.

import { ExternalLink } from "lucide-react";

import {
  montarHrefMapsLoja,
  type EnderecoColunasLoja,
} from "@/lib/utils/enderecoLoja";

export type LinkMapsLojaProps = {
  loja: EnderecoColunasLoja | null;
  className?: string;
};

export function LinkMapsLoja({ loja, className }: LinkMapsLojaProps) {
  const href = loja ? montarHrefMapsLoja(loja) : null;
  if (!href) return null;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={[
        "mt-1 inline-flex items-center gap-1.5 text-sm font-medium text-destaque underline underline-offset-2",
        className ?? "",
      ].join(" ")}
    >
      <ExternalLink aria-hidden className="size-4" />
      Abrir no Google Maps
      <span className="sr-only">(abre em nova aba)</span>
    </a>
  );
}

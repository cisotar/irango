"use client";

import { urlLinkExternoSegura } from "@/lib/utils/urlLinkExternoSegura";
import type { LinkExternoValidado } from "@/lib/validacoes/mensagemModal";

/**
 * Aviso de saída de um link da mensagem do modal sazonal (spec
 * modal-sazonal-mensagem-formatada, RN-M12). Vista DENTRO do mesmo dialog do
 * `ModalSazonal` (nunca um segundo dialog).
 *
 *  - revalida o link com `urlLinkExternoSegura` no próprio render (seguranca.md
 *    §15: todo `href` vindo do banco passa pelo guard onde é renderizado). Falhou:
 *    "Este link não está disponível." e NENHUM `<a>`;
 *  - mostra o hostname canônico (punycode, anti-homógrafo) em destaque e o
 *    endereço completo como texto;
 *  - `target`, `rel` e `referrerPolicy` são LITERAIS fixos, nunca props: a aba
 *    nova não controla a vitrine (`window.opener`) nem recebe a URL da loja;
 *  - "Continuar" chama `aoContinuar` SEM `preventDefault` (a aba abre e o modal
 *    fecha); "Voltar" chama `aoVoltar`.
 */

type Props = {
  link: LinkExternoValidado;
  aoContinuar: () => void;
  aoVoltar: () => void;
};

const CLASSE_CONTINUAR =
  "inline-flex min-h-[52px] w-full items-center justify-center rounded-xl bg-[var(--cor-primaria)] px-4 text-center text-sm font-bold text-white focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[var(--cor-primaria)]";
const CLASSE_VOLTAR =
  "inline-flex min-h-[44px] w-full items-center justify-center rounded-xl border border-borda-nav px-4 text-sm font-semibold text-texto focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[var(--cor-primaria)]";

export function AvisoSaidaLink({ link, aoContinuar, aoVoltar }: Props) {
  const canonico = urlLinkExternoSegura(link);

  if (canonico === null) {
    return (
      <div className="flex flex-col gap-4 px-4">
        <p className="text-sm text-texto">Este link não está disponível.</p>
        <button type="button" onClick={aoVoltar} className={CLASSE_VOLTAR}>
          Voltar
        </button>
      </div>
    );
  }

  const hostname = new URL(canonico).hostname;

  return (
    <div className="flex flex-col gap-4 px-4 break-words [overflow-wrap:anywhere]">
      <div className="flex flex-col gap-1">
        <p className="text-sm text-texto-muted">Este link leva para fora da loja, em</p>
        <p className="text-lg font-bold text-texto">{hostname}</p>
        <p className="font-mono text-xs text-texto-muted">{canonico}</p>
      </div>
      <p className="text-sm text-texto">Confira o endereço antes de continuar.</p>
      <div className="flex flex-col gap-2">
        <a
          href={canonico}
          target="_blank"
          rel="noopener noreferrer"
          referrerPolicy="no-referrer"
          onClick={aoContinuar}
          className={CLASSE_CONTINUAR}
        >
          {`Continuar para ${hostname}`}
        </a>
        <button type="button" onClick={aoVoltar} className={CLASSE_VOLTAR}>
          Voltar
        </button>
      </div>
    </div>
  );
}

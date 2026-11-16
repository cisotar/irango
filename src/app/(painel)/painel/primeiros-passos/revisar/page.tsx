import type { ReactElement, ReactNode } from "react";
import Link from "next/link";
import { CheckCircle2, Circle, CircleAlert } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CartaoPublicacao } from "@/components/painel/CartaoPublicacao";
import { BotaoLocalizarEndereco } from "@/components/painel/BotaoLocalizarEndereco";
import { definirPublicacao, localizarEnderecoDeNovo } from "@/lib/actions/loja";
import { cn } from "@/lib/utils";
import {
  mensagemPendencia,
  pendenciasPublicacao,
  podePublicarLoja,
  type PendenciaPublicacao,
} from "@/lib/utils/publicacao";
import { etapaDaPendencia, rotaDaEtapa } from "@/lib/utils/primeirosPassos";
import { exigirAssistente } from "../guard";

type TipoPendencia = PendenciaPublicacao["tipo"];

/**
 * As 5 linhas fixas do checklist, na ordem do `## UX` da issue 368. A linha de
 * localização não tem link: a ação dela é o botão D14.
 */
const LINHAS: readonly { tipo: TipoPendencia; titulo: string; rotuloLink?: string }[] = [
  { tipo: "perfil", titulo: "Nome e WhatsApp", rotuloLink: "Ir para Perfil" },
  { tipo: "endereco", titulo: "Endereço", rotuloLink: "Ir para Perfil" },
  { tipo: "localizacao", titulo: "Localização no mapa" },
  { tipo: "pagamento", titulo: "Forma de pagamento", rotuloLink: "Ir para Pagamentos" },
  { tipo: "produto", titulo: "Produto disponível", rotuloLink: "Ir para Produtos" },
];

function subtitulo(n: number): string {
  if (n === 0) return "Tudo pronto. Publique para a vitrine aparecer para os clientes.";
  if (n === 1) return "Resolva o item marcado para publicar a loja.";
  return `Resolva os ${n} itens marcados para publicar a loja.`;
}

/**
 * Etapa "Revisar e publicar" (issue 368, D8/D9). Único lugar do assistente com
 * o botão de publicar. Checklist e bloqueio derivam da MESMA
 * `pendenciasPublicacao` do gate; são só preview: `definirPublicacao` relê o
 * banco e decide. Depois de publicar, `/painel` (D9). A linha "Localização no
 * mapa" traz o botão D14 quando só falta o par.
 */
export default async function EtapaRevisarPage(): Promise<ReactElement> {
  const { estado } = await exigirAssistente();
  const pendencias = pendenciasPublicacao(estado);
  const porTipo = new Map(pendencias.map((p) => [p.tipo, p] as const));
  const gate = podePublicarLoja(estado);

  return (
    <>
      <Card>
        <CardContent className="space-y-1">
          <h1 className="font-heading text-xl font-semibold text-foreground">
            Revisar e publicar
          </h1>
          <p className="text-sm text-muted-foreground">{subtitulo(pendencias.length)}</p>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <ul aria-label="O que a loja precisa para ir ao ar" className="divide-y">
            {LINHAS.map((linha) => {
              const pendencia = porTipo.get(linha.tipo) ?? null;
              const aguardando =
                linha.tipo === "localizacao" && porTipo.has("endereco");
              return (
                <LinhaChecklist
                  key={linha.tipo}
                  titulo={linha.titulo}
                  estado={pendencia ? "pendente" : aguardando ? "aguardando" : "pronto"}
                  texto={
                    pendencia
                      ? mensagemPendencia(pendencia)
                      : aguardando
                        ? "Complete o endereço para localizar a loja no mapa."
                        : null
                  }
                  acao={
                    pendencia === null ? null : linha.tipo === "localizacao" ? (
                      <BotaoLocalizarEndereco onLocalizar={localizarEnderecoDeNovo} />
                    ) : (
                      <Link
                        href={rotaDaEtapa(etapaDaPendencia(pendencia))}
                        className={cn(
                          buttonVariants({ variant: "outline", size: "sm" }),
                          "min-h-[44px] w-full sm:w-auto",
                        )}
                      >
                        {linha.rotuloLink}
                      </Link>
                    )
                  }
                />
              );
            })}
          </ul>
        </CardContent>
      </Card>

      <CartaoPublicacao
        publicado={false}
        bloqueio={gate.ok ? null : mensagemPendencia(gate.pendencia)}
        onDefinirPublicacao={definirPublicacao}
        destinoAposPublicar="/painel"
      />
    </>
  );
}

function LinhaChecklist({
  titulo,
  estado,
  texto,
  acao,
}: {
  titulo: string;
  estado: "pronto" | "pendente" | "aguardando";
  texto: string | null;
  acao: ReactNode;
}): ReactElement {
  return (
    <li className="flex gap-3 py-3 first:pt-0 last:pb-0">
      {estado === "pronto" ? (
        <CheckCircle2 aria-hidden className="mt-0.5 size-5 shrink-0 text-foreground" />
      ) : estado === "pendente" ? (
        <CircleAlert aria-hidden className="mt-0.5 size-5 shrink-0 text-amber-800" />
      ) : (
        <Circle
          aria-hidden
          strokeDasharray="3 3"
          className="mt-0.5 size-5 shrink-0 text-muted-foreground"
        />
      )}
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex items-start justify-between gap-3">
          <p className="font-medium text-foreground">
            {titulo}
            {estado !== "pronto" && (
              <span className="sr-only">
                {estado === "pendente" ? " (pendente)" : " (aguardando)"}
              </span>
            )}
          </p>
          {estado === "pronto" && (
            <span className="shrink-0 text-sm text-muted-foreground">Pronto</span>
          )}
        </div>
        {texto && <p className="text-sm text-muted-foreground">{texto}</p>}
        {acao}
      </div>
    </li>
  );
}

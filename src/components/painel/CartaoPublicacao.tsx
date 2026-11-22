"use client";

import { useId, useTransition, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { definirPublicacao } from "@/lib/actions/loja";

/**
 * Cartão "Status da vitrine" (issue 368, DD6), extraído do `PerfilClient` e
 * reusado no perfil do painel, no perfil do hub admin e na etapa "revisar" do
 * assistente. Todas as props são obrigatórias (issue 160): quem renderiza injeta
 * a action certa (lojista ou admin por `lojaId`).
 *
 * `bloqueio` é o texto D10 da 1ª pendência do gate (`null` = pode publicar). É
 * só preview de UX: `definirPublicacao`/`publicarLojaAdmin` relêem o banco e
 * decidem. Despublicar nunca é bloqueado.
 */
export function CartaoPublicacao({
  publicado,
  bloqueio,
  onDefinirPublicacao,
  destinoAposPublicar,
}: {
  publicado: boolean;
  bloqueio: string | null;
  onDefinirPublicacao: typeof definirPublicacao;
  /** Rota após publicar com sucesso; `null` = só `router.refresh()`. */
  destinoAposPublicar: string | null;
}): ReactElement {
  const router = useRouter();
  const [publicando, startPublicacao] = useTransition();
  const idTexto = useId();

  const bloqueado = !publicado && bloqueio !== null;

  function alternarPublicacao() {
    startPublicacao(async () => {
      const r = await onDefinirPublicacao(!publicado);
      if (!r.ok) {
        toast.error(r.erro);
        return;
      }
      toast.success(publicado ? "Loja despublicada." : "Loja publicada!");
      if (!publicado && destinoAposPublicar !== null) {
        router.replace(destinoAposPublicar);
        return;
      }
      router.refresh();
    });
  }

  const texto = publicado
    ? "Sua vitrine está visível e aceitando pedidos."
    : (bloqueio ?? "Sua vitrine está oculta. Publique para receber pedidos.");

  return (
    <Card className="mb-4">
      <CardContent className="flex flex-wrap items-center justify-between gap-3 p-6">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <span className="font-medium text-foreground">Status da vitrine</span>
            {publicado ? (
              <Badge variant="secondary">No ar</Badge>
            ) : (
              <Badge variant="outline">Rascunho</Badge>
            )}
          </div>
          <p id={idTexto} className="text-sm text-muted-foreground">
            {texto}
          </p>
          {!publicado && !bloqueado && destinoAposPublicar !== null && (
            <p className="text-sm text-muted-foreground">
              Depois de publicar, você vai para o painel da loja.
            </p>
          )}
        </div>
        <Button
          type="button"
          variant={publicado ? "outline" : "default"}
          disabled={publicando || bloqueado}
          aria-describedby={idTexto}
          onClick={alternarPublicacao}
          className="min-h-[44px] w-full sm:w-auto"
        >
          {publicando && <Loader2 aria-hidden className="mr-2 size-4 animate-spin" />}
          {publicado ? "Despublicar" : "Publicar loja"}
        </Button>
      </CardContent>
    </Card>
  );
}

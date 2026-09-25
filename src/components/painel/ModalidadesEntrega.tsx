"use client";

// Modalidades de entrega da loja (spec modalidades-entrega-loja): liga/desliga
// retirada e entrega e escolhe o modo do frete. Compartilhado pelo painel e pelo
// hub admin via `EntregasClient` — a action é INJETADA (lojista ou admin).
//
// O zod (`schemaModalidadesEntrega`) é o MESMO do servidor: aqui é só gate de
// UX; a action revalida e o CHECK `lojas_ao_menos_uma_modalidade` é a última
// linha. As zonas não são tocadas por este salvar: continuam guardadas com a
// entrega desligada ou no modo a combinar.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import {
  schemaModalidadesEntrega,
  type DadosModalidadesEntrega,
  type ModoFrete,
} from "@/lib/validacoes/entrega";
import type { ZonaVitrine } from "@/lib/supabase/queries/entregaPagamento";
import { entregaDisponivel } from "@/lib/utils/modalidadesEntrega";

export type ModalidadesEntregaProps = {
  inicial: DadosModalidadesEntrega;
  /** Zonas da loja — só para o aviso D4 (entrega sem zona nem fallback). */
  zonas: ZonaVitrine[];
  /** `lojas.taxa_entrega_fora_zona` — só para o aviso D4. */
  taxaForaZona: number | null;
  salvar: (payload: DadosModalidadesEntrega) => Promise<{ ok: true } | { ok: false; erro: string }>;
};

const LINHA = "flex min-h-11 items-center justify-between gap-3";

export function ModalidadesEntrega({
  inicial,
  zonas,
  taxaForaZona,
  salvar,
}: ModalidadesEntregaProps) {
  const router = useRouter();
  const [valores, setValores] = useState<DadosModalidadesEntrega>(inicial);
  const [salvando, startSalvar] = useTransition();

  const validacao = schemaModalidadesEntrega.safeParse(valores);
  const erro = validacao.success ? null : (validacao.error.issues[0]?.message ?? null);
  const alterado =
    valores.aceita_retirada !== inicial.aceita_retirada ||
    valores.aceita_entrega !== inicial.aceita_entrega ||
    valores.modo_frete !== inicial.modo_frete;

  // D4: entrega ligada que a vitrine não consegue oferecer (automático, sem
  // zona ativa e sem fallback) e retirada desligada = nenhum pedido pelo
  // cardápio. Aviso, não bloqueio: salvar continua permitido.
  const semModalidadeNaVitrine =
    !valores.aceita_retirada &&
    valores.aceita_entrega &&
    !entregaDisponivel({ ...valores, taxa_entrega_fora_zona: taxaForaZona }, zonas);

  function enviar() {
    if (!validacao.success) return;
    startSalvar(async () => {
      const r = await salvar(validacao.data);
      if (!r.ok) {
        toast.error(r.erro);
        return;
      }
      toast.success("Modalidades de entrega salvas.");
      router.refresh();
    });
  }

  return (
    <Card className="mb-6">
      <CardContent className="space-y-4 py-4">
        <div>
          <h2 className="font-heading text-base font-semibold text-foreground">
            Como seus clientes recebem o pedido
          </h2>
          <p className="text-sm text-muted-foreground">
            Deixe ligada pelo menos uma opção.
          </p>
        </div>

        <Label className={LINHA}>
          <span>
            <span className="block text-sm font-medium text-foreground">
              Retirada na loja
            </span>
            <span className="block text-xs text-muted-foreground">
              O cliente busca o pedido no balcão.
            </span>
          </span>
          <Switch
            checked={valores.aceita_retirada}
            disabled={salvando}
            onCheckedChange={(v) => setValores((s) => ({ ...s, aceita_retirada: v === true }))}
          />
        </Label>

        <Label className={LINHA}>
          <span>
            <span className="block text-sm font-medium text-foreground">Entrega</span>
            <span className="block text-xs text-muted-foreground">
              A loja leva o pedido até o cliente.
            </span>
          </span>
          <Switch
            checked={valores.aceita_entrega}
            disabled={salvando}
            onCheckedChange={(v) => setValores((s) => ({ ...s, aceita_entrega: v === true }))}
          />
        </Label>

        {valores.aceita_entrega && (
          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">Frete da entrega</p>
            <RadioGroup
              value={valores.modo_frete}
              onValueChange={(v) => setValores((s) => ({ ...s, modo_frete: v as ModoFrete }))}
              className="gap-2"
            >
              <Label
                htmlFor="modo-frete-automatico"
                className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border p-3"
              >
                <RadioGroupItem value="automatico" id="modo-frete-automatico" />
                <span>
                  <span className="block text-sm font-medium text-foreground">
                    Calculado pelas zonas de entrega
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    O cliente vê o valor do frete antes de fazer o pedido.
                  </span>
                </span>
              </Label>
              <Label
                htmlFor="modo-frete-a-combinar"
                className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border p-3"
              >
                <RadioGroupItem value="a_combinar" id="modo-frete-a-combinar" />
                <span>
                  <span className="block text-sm font-medium text-foreground">
                    Combinado no WhatsApp
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    O pedido chega sem frete e você combina o valor com o cliente.
                  </span>
                </span>
              </Label>
            </RadioGroup>
          </div>
        )}

        {semModalidadeNaVitrine && (
          <p className="flex gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              Com a retirada desligada e nenhuma zona de entrega ativa, seus clientes não
              conseguem pedir pelo cardápio. Ative uma zona abaixo, ligue a retirada ou
              escolha o frete combinado no WhatsApp.
            </span>
          </p>
        )}

        {erro && <p className="text-sm text-destructive">{erro}</p>}

        <div className="flex justify-end">
          <Button onClick={enviar} disabled={!alterado || erro != null || salvando}>
            {salvando && <Loader2 className="size-4 animate-spin" />}
            Salvar
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

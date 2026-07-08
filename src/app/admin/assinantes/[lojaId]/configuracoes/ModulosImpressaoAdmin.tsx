"use client";

import { useState, useTransition, type ReactElement } from "react";
import { ShieldAlert } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { alternarModuloImpressao } from "../../actions/admin-modulos-impressao";

type Modulo = "a4" | "termica";

type ModulosImpressaoAdminProps = {
  lojaId: string;
  modulos: { a4: boolean; termica: boolean };
};

/**
 * Card admin (SaaS) autocontido para ligar/desligar os módulos pagos de
 * impressão de uma loja-alvo (issue 143). É SÓ UX: gesto + feedback otimista.
 * A autoridade é 100% do servidor — `alternarModuloImpressao` (issue 142) prova
 * admin, valida `modulo` contra union fixo e escreve por mapa server-side. Aqui
 * NENHUMA decisão de permissão/entitlement é tomada.
 *
 * Estado local semeado das props com coerção fail-closed `=== true` (RN-3:
 * undefined/qualquer não-`true` → desligado). Preview otimista + rollback (RN-4)
 * exigem `useState` por módulo — não há prop re-derivada no mesmo render como em
 * `AcoesAssinante`, então NÃO se usa `useEffect` de sync (a action revalida e o
 * próximo load remonta com props frescas).
 *
 * Um único `useTransition`: durante a ação AMBOS os switches ficam `disabled`
 * (defesa de UX contra corrida; a defesa real é o UPDATE idempotente por `id` no
 * banco). Módulos A4 e Térmica são independentes — sem lógica cruzada.
 */
export function ModulosImpressaoAdmin({
  lojaId,
  modulos,
}: ModulosImpressaoAdminProps): ReactElement {
  const [pendente, iniciar] = useTransition();
  // Fail-closed (RN-3): só `=== true` liga; undefined/qualquer outro = desligado.
  const [a4, setA4] = useState(modulos.a4 === true);
  const [termica, setTermica] = useState(modulos.termica === true);

  function alternar(
    modulo: Modulo,
    rotulo: string,
    novo: boolean,
    setEstado: (valor: boolean) => void,
    anterior: boolean,
  ): void {
    setEstado(novo); // preview otimista (RN-4) — não-autoritativo.
    iniciar(async () => {
      try {
        const r = await alternarModuloImpressao(lojaId, modulo, novo);
        if (r.ok) {
          toast.success(`${rotulo} ${novo ? "ativada" : "desativada"}.`);
        } else {
          setEstado(anterior); // rollback (RN-4)
          toast.error(r.erro ?? "Não foi possível alterar o módulo.");
        }
      } catch {
        // Falha de admin propaga como exceção (D-4): não vira `{ ok:false }`.
        setEstado(anterior); // rollback (RN-4)
        toast.error("Não foi possível alterar o módulo.");
      }
    });
  }

  return (
    <Card aria-busy={pendente} className="border-l-4 border-amber-400">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldAlert
            className="size-4 text-amber-600 dark:text-amber-400"
            aria-hidden
          />
          Módulos pagos
        </CardTitle>
        <Badge
          variant="secondary"
          className="w-fit bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200"
        >
          Controle do SaaS · não visível ao lojista
        </Badge>
        <CardDescription>
          Libere ou bloqueie recursos pagos desta loja. O efeito é imediato no
          seletor de impressão do lojista.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col">
        <LinhaModulo
          id="modulo-impressao-a4"
          titulo="Impressão A4/PDF"
          descricao="Libera a variante Comum (A4) no seletor de impressão de pedidos."
          ativo={a4}
          pendente={pendente}
          onAlternar={(novo) =>
            alternar("a4", "Impressão A4/PDF", novo, setA4, a4)
          }
        />
        <Separator />
        <LinhaModulo
          id="modulo-impressao-termica"
          titulo="Impressão Térmica"
          descricao="Libera as variantes Via cozinha e Recibo (bobina 80mm) no seletor de impressão."
          ativo={termica}
          pendente={pendente}
          onAlternar={(novo) =>
            alternar("termica", "Impressão Térmica", novo, setTermica, termica)
          }
        />
      </CardContent>
    </Card>
  );
}

type LinhaModuloProps = {
  id: string;
  titulo: string;
  descricao: string;
  ativo: boolean;
  pendente: boolean;
  onAlternar: (novo: boolean) => void;
};

/**
 * Uma linha rótulo/descrição/switch. O `Label htmlFor` (clicável, `cursor-pointer`)
 * amplia o alvo de toque: o switch é 20×36, mas o `min-h-11`/`py-3` da linha dá o
 * alvo de 44px recomendado. Estado textual "Ativo"/"Inativo" ao lado do switch.
 */
function LinhaModulo({
  id,
  titulo,
  descricao,
  ativo,
  pendente,
  onAlternar,
}: LinhaModuloProps): ReactElement {
  return (
    <div className="flex min-h-11 items-start justify-between gap-4 py-3">
      <div className="min-w-0">
        <Label htmlFor={id} className="cursor-pointer">
          {titulo}
        </Label>
        <p className="mt-1 text-sm text-muted-foreground">{descricao}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className="text-xs text-muted-foreground">
          {ativo ? "Ativo" : "Inativo"}
        </span>
        <Switch
          id={id}
          checked={ativo}
          disabled={pendente}
          onCheckedChange={onAlternar}
        />
      </div>
    </div>
  );
}

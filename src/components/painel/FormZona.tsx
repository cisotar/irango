"use client";

import { useState, useTransition } from "react";
import { Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { schemaZonaCompleta } from "@/lib/validacoes/entrega";
import {
  criarZona as criarZonaLojista,
  atualizarZona as atualizarZonaLojista,
} from "@/lib/actions/entrega";

export type ZonaInicial = {
  id: string;
  nome: string;
  tipo: string;
  ativo: boolean;
  taxa: number | null;
  pedido_minimo_gratis: number | null;
  raio_max_km: number | null;
  bairros: string[];
};

export type FormZonaProps = {
  /** Se presente (com `id`), o form opera em modo edição. */
  inicial?: ZonaInicial;
  onSucesso?: () => void;
  /** Action de criação. Default: action do lojista. A via admin injeta a variante por `lojaId`. */
  onCriar?: typeof criarZonaLojista;
  /** Action de edição. Default: action do lojista. */
  onAtualizar?: typeof atualizarZonaLojista;
};

type TipoZona = "bairro" | "raio_km" | "faixa_cep";

const selectClassName =
  "flex h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50";

/** Converte string de moeda BR (vírgula) para número; vazio → null. */
function paraNumero(valor: string): number | null {
  const limpo = valor.replace(",", ".").trim();
  if (limpo === "") return null;
  const n = Number(limpo);
  return Number.isNaN(n) ? null : n;
}

/**
 * Form de zona de entrega (issue 046). Client component.
 *
 * Valida no client com `schemaZonaCompleta` (022) — gate de UX. A Server Action
 * (032/046) revalida o MESMO schema, deriva `loja_id` do dono e escopa por id.
 */
export function FormZona({
  inicial,
  onSucesso,
  onCriar = criarZonaLojista,
  onAtualizar = atualizarZonaLojista,
}: FormZonaProps) {
  const ehEdicao = inicial?.id != null;

  const [nome, setNome] = useState(inicial?.nome ?? "");
  const [tipo, setTipo] = useState<TipoZona>(
    (inicial?.tipo as TipoZona) ?? "bairro",
  );
  const [taxa, setTaxa] = useState(
    inicial?.taxa != null ? String(inicial.taxa) : "",
  );
  const [pedidoMinimoGratis, setPedidoMinimoGratis] = useState(
    inicial?.pedido_minimo_gratis != null
      ? String(inicial.pedido_minimo_gratis)
      : "",
  );
  const [raioMaxKm, setRaioMaxKm] = useState(
    inicial?.raio_max_km != null ? String(inicial.raio_max_km) : "",
  );
  const [ativo, setAtivo] = useState(inicial?.ativo ?? true);

  const [bairros, setBairros] = useState<string[]>(inicial?.bairros ?? []);
  const [novoBairro, setNovoBairro] = useState("");

  const [enviando, startEnvio] = useTransition();

  function adicionarBairro() {
    const limpo = novoBairro.trim();
    if (!limpo) return;
    if (bairros.some((b) => b.toLowerCase() === limpo.toLowerCase())) {
      setNovoBairro("");
      return;
    }
    setBairros((atual) => [...atual, limpo]);
    setNovoBairro("");
  }

  function removerBairro(nomeBairro: string) {
    setBairros((atual) => atual.filter((b) => b !== nomeBairro));
  }

  function montarPayload() {
    return {
      nome: nome.trim(),
      tipo,
      ativo,
      taxa: {
        taxa: paraNumero(taxa) ?? 0,
        pedido_minimo_gratis: paraNumero(pedidoMinimoGratis),
        raio_max_km: tipo === "raio_km" ? paraNumero(raioMaxKm) : null,
      },
      bairros: tipo === "bairro" ? bairros : [],
    };
  }

  function salvar() {
    const parsed = schemaZonaCompleta.safeParse(montarPayload());
    if (!parsed.success) {
      toast.error(
        parsed.error.issues[0]?.message ?? "Confira os dados da zona.",
      );
      return;
    }

    startEnvio(async () => {
      const resultado =
        ehEdicao && inicial?.id
          ? await onAtualizar(inicial.id, parsed.data)
          : await onCriar(parsed.data);

      if (!resultado.ok) {
        toast.error(resultado.erro);
        return;
      }
      toast.success("Zona salva!");
      onSucesso?.();
    });
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        salvar();
      }}
    >
      <div className="space-y-1">
        <Label htmlFor="zona-nome">Nome da zona</Label>
        <Input
          id="zona-nome"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder="Ex.: Centro"
          required
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="zona-tipo">Tipo</Label>
        <select
          id="zona-tipo"
          value={tipo}
          onChange={(e) => setTipo(e.target.value as TipoZona)}
          className={selectClassName}
        >
          <option value="bairro">Por bairro</option>
          <option value="raio_km">Por raio (km)</option>
          <option value="faixa_cep">Por faixa de CEP</option>
        </select>
      </div>

      <div className="space-y-1">
        <Label htmlFor="zona-taxa">Taxa de entrega (R$)</Label>
        <Input
          id="zona-taxa"
          value={taxa}
          onChange={(e) => setTaxa(e.target.value)}
          placeholder="5,00"
          inputMode="decimal"
          required
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="zona-gratis">Frete grátis acima de (R$, opcional)</Label>
        <Input
          id="zona-gratis"
          value={pedidoMinimoGratis}
          onChange={(e) => setPedidoMinimoGratis(e.target.value)}
          placeholder="Sem frete grátis se vazio"
          inputMode="decimal"
        />
      </div>

      {tipo === "raio_km" && (
        <div className="space-y-1">
          <Label htmlFor="zona-raio">Raio máximo (km)</Label>
          <Input
            id="zona-raio"
            value={raioMaxKm}
            onChange={(e) => setRaioMaxKm(e.target.value)}
            placeholder="Ex.: 5"
            inputMode="decimal"
            aria-describedby="zona-raio-ajuda"
          />
          <p id="zona-raio-ajuda" className="text-xs text-muted-foreground">
            Configure com margem: CEPs brasileiros podem cair no centro do
            bairro ou da cidade, não no endereço exato. Para atender 5 km reais,
            configure 7-8 km.
          </p>
        </div>
      )}

      {tipo === "bairro" && (
        <div className="space-y-2">
          <Label htmlFor="zona-bairro">Bairros atendidos</Label>
          <div className="flex gap-2">
            <Input
              id="zona-bairro"
              value={novoBairro}
              onChange={(e) => setNovoBairro(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  adicionarBairro();
                }
              }}
              placeholder="Nome do bairro"
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Adicionar bairro"
              onClick={adicionarBairro}
            >
              <Plus className="size-4" />
            </Button>
          </div>
          {bairros.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {bairros.map((b) => (
                <Badge key={b} variant="secondary" className="gap-1">
                  {b}
                  <button
                    type="button"
                    aria-label={`Remover ${b}`}
                    onClick={() => removerBairro(b)}
                    className="rounded-full hover:text-destructive"
                  >
                    <X className="size-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}
        </div>
      )}

      <label className="flex cursor-pointer items-center gap-2 text-sm">
        <Checkbox
          checked={ativo}
          onCheckedChange={(v) => setAtivo(v === true)}
        />
        <span className="text-foreground">Zona ativa</span>
      </label>

      <Button type="submit" className="w-full" disabled={enviando}>
        {enviando && <Loader2 className="mr-2 size-4 animate-spin" />}
        {ehEdicao ? "Salvar alterações" : "Criar zona"}
      </Button>
    </form>
  );
}

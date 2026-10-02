"use client";

import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { OUTRO_ENDERECO, type EnderecoClienteCheckout } from "./clienteCheckout";

const CLASSE_OPCAO =
  "flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-cinza-medio p-3 has-[[data-checked]]:border-[var(--cor-destaque)] has-[[data-checked]]:bg-[var(--cor-destaque)]/5";

/**
 * (343) Escolha entre os ≤3 endereços salvos do cliente ou "Usar outro
 * endereço". Só preenche o `FormEndereco`: editar ali vale só para este pedido.
 */
export function SeletorEnderecoCliente({
  enderecos,
  valor,
  onChange,
}: {
  enderecos: EnderecoClienteCheckout[];
  valor: string;
  onChange: (id: string) => void;
}) {
  return (
    <RadioGroup value={valor} onValueChange={(v) => onChange(String(v))} className="gap-2">
      {enderecos.map((e) => (
        <Label key={e.id} htmlFor={`endereco-cliente-${e.id}`} className={CLASSE_OPCAO}>
          <RadioGroupItem value={e.id} id={`endereco-cliente-${e.id}`} />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium text-texto">{e.rotulo}</span>
            <span className="block truncate text-xs text-texto-muted">
              {e.endereco.rua}, {e.endereco.numero} · {e.endereco.bairro}
            </span>
          </span>
        </Label>
      ))}
      <Label htmlFor="endereco-cliente-outro" className={CLASSE_OPCAO}>
        <RadioGroupItem value={OUTRO_ENDERECO} id="endereco-cliente-outro" />
        <span className="text-sm font-medium text-texto">Usar outro endereço</span>
      </Label>
    </RadioGroup>
  );
}

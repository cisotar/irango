"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { sairCliente } from "@/lib/actions/cliente";
import { Button } from "@/components/ui/button";

/** D12: "Sair" no topo de /minha-conta; sem `next` → `/` (a action redireciona). */
export function BotaoSair() {
  const [pendente, iniciar] = useTransition();
  return (
    <Button
      type="button"
      variant="ghost"
      className="min-h-11"
      disabled={pendente}
      onClick={() =>
        iniciar(async () => {
          const r = await sairCliente({});
          if (r && !r.ok) toast.error(r.erro);
        })
      }
    >
      {pendente && <Loader2 className="animate-spin" aria-hidden="true" />}
      Sair
    </Button>
  );
}

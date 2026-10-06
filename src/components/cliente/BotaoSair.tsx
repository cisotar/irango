"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Loader2, LogOut } from "lucide-react";
import { sairCliente } from "@/lib/actions/cliente";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * D12: "Sair" na navegação lateral de /minha-conta e no menu da vitrine. Sem
 * `next` → `/`; com `next` (sanitizado de novo pela action) → volta para lá.
 */
export function BotaoSair({
  next,
  className,
  icone = false,
}: { next?: string; className?: string; icone?: boolean } = {}) {
  const [pendente, iniciar] = useTransition();
  return (
    <Button
      type="button"
      variant="ghost"
      className={cn("min-h-11", className)}
      disabled={pendente}
      onClick={() =>
        iniciar(async () => {
          const r = await sairCliente(next ? { next } : {});
          if (r && !r.ok) toast.error(r.erro);
        })
      }
    >
      {pendente ? (
        <Loader2 className="animate-spin" aria-hidden="true" />
      ) : (
        icone && <LogOut aria-hidden="true" />
      )}
      Sair
    </Button>
  );
}

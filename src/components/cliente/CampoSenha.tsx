"use client";

import { useState, type ComponentProps } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Senha com "olho" (padrão do `LoginForm`), alvos ≥ 44px. */
export function CampoSenha(props: Omit<ComponentProps<typeof Input>, "type">) {
  const [mostrar, setMostrar] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <Input {...props} type={mostrar ? "text" : "password"} className="min-h-11" />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-11"
        aria-label={mostrar ? "Ocultar senha" : "Mostrar senha"}
        aria-pressed={mostrar}
        onClick={() => setMostrar((v) => !v)}
      >
        {mostrar ? <EyeOff /> : <Eye />}
      </Button>
    </div>
  );
}

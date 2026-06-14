import { AlertTriangle } from "lucide-react";

import { Card } from "@/components/ui/card";

/**
 * Aviso destacado de que o conteúdo legal é placeholder (issue 062). Reusado em
 * /termos e /privacidade — conteúdo deve ser revisado por jurídico antes de
 * operar comercialmente (seguranca.md §20: "redigir política de privacidade e
 * termo de uso antes de operar comercialmente").
 */
export function AvisoJuridicoPlaceholder() {
  return (
    <Card className="flex flex-row items-start gap-3 border-amber-300 bg-amber-50 p-4 text-amber-900">
      <AlertTriangle aria-hidden className="mt-0.5 size-5 shrink-0" />
      <p className="text-sm font-medium">
        Conteúdo placeholder — revisar com jurídico antes de operar
        comercialmente.
      </p>
    </Card>
  );
}

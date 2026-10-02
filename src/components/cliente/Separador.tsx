import { Separator } from "@/components/ui/separator";

/** "ou …" entre o Google e o formulário de e-mail. */
export function SeparadorOu({ texto }: { texto: string }) {
  return (
    <div className="my-4 flex items-center gap-3">
      <Separator className="flex-1" />
      <span className="text-sm text-texto-muted">{texto}</span>
      <Separator className="flex-1" />
    </div>
  );
}

import { LinkVoltarLoja } from "@/components/cliente/LinkVoltarLoja";
import { MarcaIRango } from "@/components/cliente/MarcaIRango";

/** Topo das telas `/conta/*`: "Voltar para <loja>" (se houver) + marca iRango. */
export function TopoConta({ next }: { next: string | undefined }) {
  return (
    <>
      <LinkVoltarLoja next={next} />
      <MarcaIRango />
    </>
  );
}

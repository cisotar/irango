import { exigirCliente } from "./guard";
import { MarcaIRango } from "@/components/cliente/MarcaIRango";

// Guard da área logada do cliente (spec: em `minha-conta/layout.tsx`, não no
// middleware — architecture.md §5). Cada página repete `exigirCliente` com a
// própria rota (dedupe por `cache`), porque o layout não re-renderiza em
// navegação entre páginas irmãs.
export default async function MinhaContaLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  await exigirCliente("/minha-conta");
  return (
    <>
      <MarcaIRango />
      {children}
    </>
  );
}

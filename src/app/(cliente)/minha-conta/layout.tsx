import { exigirCliente } from "./guard";
import { ehAdminSaaS } from "@/lib/auth/admin";
import { ShellConta } from "@/components/cliente/conta/ShellConta";

// Guard da área logada do cliente (spec: em `minha-conta/layout.tsx`, não no
// middleware — architecture.md §5). Cada página repete `exigirCliente` com a
// própria rota (dedupe por `cache`), porque o layout não re-renderiza em
// navegação entre páginas irmãs. A moldura (kebab + navegação lateral) é a
// mesma na página única e nas páginas dedicadas.
export default async function MinhaContaLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const { user, papeis } = await exigirCliente("/minha-conta");
  // D8: lojista/admin + cliente perdem só o perfil (texto do aviso muda).
  const soPerfil = papeis.includes("lojista") || ehAdminSaaS(user.id);
  return (
    <ShellConta email={user.email ?? ""} soPerfil={soPerfil}>
      {children}
    </ShellConta>
  );
}

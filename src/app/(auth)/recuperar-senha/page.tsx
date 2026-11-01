// /recuperar-senha — pedido do link da porta lojista (issue 366). Funciona igual
// com ou sem sessão. `?erro=link` vem do callback (link inválido/expirado).
import { FormRecuperarSenha } from "./FormRecuperarSenha";

export default async function RecuperarSenhaPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string | string[] }>;
}) {
  const params = await searchParams;
  return <FormRecuperarSenha linkInvalido={params.erro === "link"} />;
}

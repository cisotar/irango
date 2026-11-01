// /nova-senha — troca de senha da porta lojista (issue 366). O form só aparece
// com sessão aberta pelo link de recuperação; a autoridade é `confirmarNovaSenha`.
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { temSessaoDeRecuperacao } from "@/lib/auth/temSessaoDeRecuperacao";
import { AlertaErro } from "@/components/cliente/Alerta";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormNovaSenha } from "./FormNovaSenha";

const MSG_LINK = "Link inválido ou expirado. Peça um novo link e abra-o neste mesmo navegador.";

async function podeTrocarSenha(): Promise<boolean> {
  // Fora do try: `cookies()` precisa marcar a rota como dinâmica no build.
  const supabase = await createClient();
  try {
    return await temSessaoDeRecuperacao(supabase);
  } catch (e) {
    console.error("[novaSenha] sessao", e instanceof Error ? e.name : "erro");
    return false;
  }
}

export default async function NovaSenhaPage() {
  if (await podeTrocarSenha()) return <FormNovaSenha />;

  return (
    <Card className="mx-auto max-w-sm">
      <CardHeader>
        <CardTitle className="text-center text-xl">Nova senha</CardTitle>
      </CardHeader>
      <CardContent>
        <AlertaErro>{MSG_LINK}</AlertaErro>
        <Link href="/recuperar-senha" className={buttonVariants({ className: "min-h-11 w-full" })}>
          Pedir novo link
        </Link>
      </CardContent>
    </Card>
  );
}

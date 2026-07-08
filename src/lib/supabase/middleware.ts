import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  // Só refresh de cookie/sessão via getUser. NÃO participa de authz e NÃO
  // propaga nenhum header de rota derivado do transporte (removido na issue 143): a
  // decisão de acesso ao painel é 100% server-side nos layouts, sem input de
  // transporte controlável pelo cliente (spec RN-02/RN-05, classe CVE-2025-29927).

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // IMPORTANTE: não rodar código entre createServerClient e getUser().
  await supabase.auth.getUser();

  return supabaseResponse;
}

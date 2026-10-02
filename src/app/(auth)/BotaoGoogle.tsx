"use client";

import { entrarComGoogle, type OpcoesEntrarComGoogle } from "@/lib/auth/googleOAuth";

type PropsBotaoGoogle = OpcoesEntrarComGoogle & {
  /** Rótulo do botão. Só a porta cliente passa ("Continuar com Google", D1). */
  rotulo?: string;
};

const CLASSE_BASE =
  "flex w-full items-center justify-center gap-3 rounded-md border px-4 py-2 text-sm font-medium shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
/** Porta `(auth)` do lojista: botão claro original (inalterado, D1). */
const CLASSE_CLARO =
  "min-h-11 border-[#dadce0] bg-white text-[#3c4043] hover:bg-[#f8f9fa] hover:border-[#c6c6c6]";
/** Porta cliente: estilo escuro oficial do Google (decisão do usuário). */
const CLASSE_ESCURO = "min-h-12 border-[#8e918f] bg-[#131314] text-[#e3e3e3] hover:bg-[#2a2a2c] focus-visible:ring-offset-2";

/** Sem props = porta `(auth)` do lojista; `contexto="cliente"` + `next` = porta cliente (issue 336). */
export function BotaoGoogle({ contexto, next, rotulo = "Entrar com Google" }: PropsBotaoGoogle = {}) {
  const classe = `${CLASSE_BASE} ${contexto === "cliente" ? CLASSE_ESCURO : CLASSE_CLARO}`;
  return (
    <button type="button" onClick={() => entrarComGoogle({ contexto, next })} className={classe}>
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
        <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615Z"/>
        <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z"/>
        <path fill="#FBBC05" d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332Z"/>
        <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.962L3.964 6.294C4.672 4.167 6.656 3.58 9 3.58Z"/>
      </svg>
      {rotulo}
    </button>
  );
}

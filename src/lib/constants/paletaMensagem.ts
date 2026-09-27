// Paleta FIXA da mensagem do modal sazonal (spec modal-sazonal-mensagem-formatada,
// RN-M13). O lojista escolhe uma CHAVE; nunca um hex. Cada tom tem contraste
// WCAG ≥ 4,5:1 sobre `FUNDO_MODAL_MENSAGEM`, travado por teste
// (`contrasteWcag.test.ts` e tests/seguranca/modal-sazonal/v7-redress A25).
// Trocar um tom só por outro que passe no teste. As cores do tema da loja
// (`--cor-primaria`/`--cor-destaque`) NUNCA entram aqui.
//
// Premissa: a vitrine não usa `.dark`. Se usar, esta paleta precisa de um
// segundo conjunto validado contra o fundo escuro.

/** Chaves do enum `cor` do trecho (ausente = cor de texto do modal). */
export const CORES_MENSAGEM = [
  "marrom",
  "vermelho",
  "laranja",
  "verde",
  "azul",
  "roxo",
  "cinza",
] as const;

export type CorMensagem = (typeof CORES_MENSAGEM)[number];

/** Tom de cada chave (#rrggbb), para o teste de contraste. */
export const PALETA_MENSAGEM: Readonly<Record<CorMensagem, string>> = Object.freeze({
  marrom: "#3e2723", // token --texto
  vermelho: "#b91c1c", // Tailwind red-700
  laranja: "#c2410c", // Tailwind orange-700
  verde: "#166534", // token --promo-texto
  azul: "#1d4ed8", // Tailwind blue-700
  roxo: "#7e22ce", // Tailwind purple-700
  cinza: "#6b5d4f", // token --texto-muted
});

/**
 * Cor fixa do link, FORA da paleta do lojista (Tailwind blue-800). Fica perto
 * do `azul`, então o sinal distintivo do link é o ícone `ExternalLink`.
 */
export const COR_LINK_MENSAGEM = "#1e40af";

/** Fundo do modal (`bg-popover` claro do Dialog, `oklch(1 0 0)`). */
export const FUNDO_MODAL_MENSAGEM = "#ffffff";

/**
 * Classe Tailwind de cada chave. Literais completos (o scanner do Tailwind só
 * gera classe que aparece inteira no código). Consultar SEMPRE com
 * `Object.hasOwn(CLASSES_COR_MENSAGEM, valor)`: `MAPA["constructor"]` devolveria
 * uma função.
 */
export const CLASSES_COR_MENSAGEM: Readonly<Record<CorMensagem, string>> = Object.freeze({
  marrom: "text-[#3e2723]",
  vermelho: "text-[#b91c1c]",
  laranja: "text-[#c2410c]",
  verde: "text-[#166534]",
  azul: "text-[#1d4ed8]",
  roxo: "text-[#7e22ce]",
  cinza: "text-[#6b5d4f]",
});

/** Classe da cor fixa do link (mesmo tom de `COR_LINK_MENSAGEM`). */
export const CLASSE_COR_LINK_MENSAGEM = "text-[#1e40af]";

/** Classe fixa por tamanho de trecho (RN-M05). Fonte única: renderer e editor. */
export const CLASSES_TAMANHO_MENSAGEM: Readonly<Record<string, string>> = Object.freeze({
  pequeno: "text-sm",
  grande: "text-lg",
  enorme: "text-xl",
});

/** Classe fixa por fonte de trecho (pilhas de sistema, sem download). Fonte única. */
export const CLASSES_FONTE_MENSAGEM: Readonly<Record<string, string>> = Object.freeze({
  serifa: "font-serif",
  mono: "font-mono",
});

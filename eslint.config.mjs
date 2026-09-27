import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    rules: {
      // Prefixo _ marca intencionalmente não-usado (ex: _hint em callbacks de tipo fixo).
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { varsIgnorePattern: "^_", argsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // Editor rico (Tiptap/ProseMirror) SÓ no painel, só nesta pasta (spec
    // modal-sazonal-mensagem-formatada, §Segurança "Dependência nova", V9/A14):
    // a vitrine não consegue importar o editor. Quem precisa dele usa
    // `next/dynamic` sobre `EditorMensagem`.
    files: ["**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"],
    ignores: ["src/components/painel/editor-mensagem/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@tiptap/*", "prosemirror-*"],
              message:
                "Tiptap/ProseMirror só em src/components/painel/editor-mensagem/ (V9). Use next/dynamic sobre EditorMensagem.",
            },
            {
              // Import transitivo: um import de valor do módulo do editor arrasta o
              // Tiptap para o bundle de quem importa. Só `import type` passa; o
              // carregamento é por `next/dynamic` (auditoria V9, achado B1).
              group: ["@/components/painel/editor-mensagem/*"],
              allowTypeImports: true,
              message:
                "Importe o editor só por next/dynamic (import de valor arrasta o Tiptap para o bundle).",
            },
          ],
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          // `import("@tiptap/…")` dinâmico escapa do no-restricted-imports.
          selector: "ImportExpression[source.value=/^(@tiptap\\u002F|prosemirror-)/]",
          message: "Tiptap/ProseMirror só em src/components/painel/editor-mensagem/ (V9).",
        },
      ],
    },
  },
]);

export default eslintConfig;

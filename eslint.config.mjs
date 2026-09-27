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
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;

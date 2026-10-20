#!/usr/bin/env bash
# Fecha no GitHub a issue [NNN] já existente. O repo é PÚBLICO e issue nova
# NÃO é criada por aqui de propósito: texto de issue (achado de segurança, plano
# interno) viraria público e indexável sem como desfazer. As issues vivem em tasks/.
# Falha fechado: qualquer dúvida => não age e sai com código != 0.
#
#   issue-github.sh fechar NNN <hash-do-commit-que-resolveu>
set -euo pipefail

GH="${GH:-/usr/bin/gh}"
[ -x "$GH" ] || GH="$HOME/.local/bin/gh"
[ -x "$GH" ] || { echo "RECUSADO: gh não encontrado" >&2; exit 2; }

recusa() { echo "RECUSADO: $1" >&2; exit 1; }

raiz="$(git rev-parse --show-toplevel)"
cd "$raiz"

# Só o repo do iRango: evita publicar em fork/remote errado.
repo="$("$GH" repo view --json nameWithOwner -q .nameWithOwner)"
[ "$repo" = "cisotar/irango" ] || recusa "repo inesperado: $repo"

cmd="${1:-}"
case "$cmd" in
fechar)
  numero="${2:-}"; commit="${3:-}"
  [[ "$numero" =~ ^[0-9]+$ ]] || recusa "número inválido"
  [[ "$commit" =~ ^[0-9a-f]{7,40}$ ]] || recusa "informe o hash do commit que resolveu"
  [ "$(git cat-file -t "$commit" 2>/dev/null)" = "commit" ] || recusa "commit inexistente"
  # Só fecha com a correção já no remoto: fechar antes de publicar mente.
  git fetch -q origin main
  git merge-base --is-ancestor "$commit" origin/main || recusa "commit $commit ainda não está em origin/main"

  achadas="$("$GH" issue list --state open --search "\"[$numero]\" in:title" --json number,title -q "[.[] | select(.title | startswith(\"[$numero] \"))] | map(.number) | .[]")"
  [ "$(printf '%s\n' "$achadas" | grep -c .)" = "1" ] || recusa "esperava exatamente 1 issue aberta [$numero], achei: $(printf '%s' "$achadas" | tr '\n' ' ')"

  # Comentário fixo: nada de texto livre de quem chama.
  "$GH" issue close "$achadas" --comment "Resolvido no commit $commit."
  echo "fechada: #$achadas"
  ;;
*)
  recusa "uso: issue-github.sh fechar NNN <commit>"
  ;;
esac

#!/bin/bash
# Relance les tests de packages/core dès qu'un fichier y est modifié.
# packages/core porte la logique métier (calculs financiers, règles de
# gestion) — une régression y est plus coûteuse qu'ailleurs (Phase 9).
# Le résultat s'affiche dans le terminal de la session en cours.

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

if [[ "$FILE_PATH" == *"packages/core/"* ]]; then
  cd "$CLAUDE_PROJECT_DIR" && pnpm --filter core test --run 2>&1 | tail -n 40
fi

exit 0

#!/bin/bash
# Bloque toute modification de fichiers sensibles.
#
# Limite connue : ce script ne distingue pas "créer une nouvelle migration"
# de "modifier une migration existante" quand l'outil Write est utilisé
# (Write sert aussi bien à créer qu'à écraser un fichier). Le motif
# packages/db/migrations bloque donc aussi la création de nouvelles
# migrations si tu passes par ce chemin — demande à Claude Code de
# proposer le nom du fichier de migration, crée-le toi-même si besoin,
# ou ajuste ce script si ça devient gênant en pratique.

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

PROTECTED_PATTERNS=(".env" ".git/" "packages/db/migrations")

for pattern in "${PROTECTED_PATTERNS[@]}"; do
  if [[ "$FILE_PATH" == *"$pattern"* ]]; then
    echo "Bloqué : $FILE_PATH correspond au motif protégé '$pattern'. Si c'est une nouvelle migration, crée-la avec 'pnpm drizzle-kit generate' plutôt qu'en écrivant le fichier directement." >&2
    exit 2
  fi
done

exit 0

---
name: new-module
description: Utiliser ce skill au démarrage d'un nouveau module listé dans docs/backlog.md. Scaffold le schéma Drizzle, la migration, le squelette de test dans packages/core, et l'entrée correspondante dans docs/data-dictionary.md, en suivant les conventions du projet. Se déclenche avec /new-module ou quand l'utilisateur dit "commence le module X".
---

# Démarrer un nouveau module

Suis ces étapes dans l'ordre. Ne passe pas à l'étape suivante avant que la
précédente soit vérifiée.

## 1. Charger le contexte

- Lis le module concerné dans docs/backlog.md (tickets, dépendances, taille)
- Vérifie dans docs/roadmap.md que les modules dont il dépend sont bien
  terminés — si non, alerte l'utilisateur avant de continuer
- Lis les tables déjà présentes dans docs/data-dictionary.md pour ne pas
  entrer en conflit avec l'existant

## 2. Schéma de données

Pour chaque nouvelle table listée dans le module :
- Ajoute-la dans packages/db avec Drizzle (respecte les conventions
  CLAUDE.md : UUID v7, colonnes d'audit, pas de suppression physique)
- Génère la migration avec `pnpm drizzle-kit generate` — ne jamais écrire
  le fichier de migration à la main

## 3. Logique métier

- Toute règle de calcul ou de transition de statut va dans packages/core,
  jamais dans apps/desktop ni apps/backend directement
- Crée le squelette de test correspondant dans packages/core avant ou en
  même temps que la logique elle-même

## 4. Documentation vivante

- Ajoute la nouvelle table dans docs/data-dictionary.md, dans le même
  commit que la migration
- Si le module touche aux finances ou aux transitions de statut
  (Modules 3, 5, 6), invoque le subagent financial-logic-reviewer avant de
  considérer le module terminé

## 5. Vérification finale

Avant de marquer le module comme terminé, confirme que le critère de
complétion défini dans docs/backlog.md pour ce module est satisfait —
pas seulement que le code compile.

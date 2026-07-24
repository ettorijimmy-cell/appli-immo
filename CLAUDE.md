# CLAUDE.md

Ce fichier donne à Claude Code le contexte nécessaire pour travailler sur ce projet.
Il est volontairement synthétique — le détail complet est dans /docs.

## Vue d'ensemble

Logiciel desktop de gestion locative (SCI, immeubles, appartements, locataires,
baux, paiements, documents). Usage personnel actuel (~20 logements, plusieurs
SCI), conçu dès le départ pour une évolution SaaS future (particuliers et
syndics). Architecture offline-first avec synchronisation cloud.

- Spécification complète : docs/app-spec.md
- Modèle de données détaillé : docs/data-dictionary.md
- Identité produit : docs/brand-brief.md
- Configuration des services externes : docs/integrations.md

## Stack technique

- Desktop : Electron + React + TypeScript + Tailwind CSS + shadcn/ui
- Backend : NestJS (Node.js/TypeScript), organisé en monolithe modulaire
- Base locale : SQLite chiffrée, gérée par PowerSync (ne pas gérer la sync à la main)
- Base cloud : PostgreSQL managé (Scaleway, région Paris) — source de vérité
- ORM : Drizzle — utilisé UNIQUEMENT côté Postgres/backend, jamais côté SQLite local
- Stockage documents : Scaleway Object Storage (S3-compatible), chiffré
- IA : SDK TypeScript Anthropic, appelé UNIQUEMENT depuis apps/backend
- Emails : Gmail API (OAuth2, compte de l'utilisateur)
- Monorepo : pnpm workspaces + Turborepo
- Tests : Vitest partout (pas de Jest, même pour NestJS — un seul runner)
- Transform Vitest côté apps/backend : unplugin-swc (pas esbuild) — esbuild
  n'émet pas `emitDecoratorMetadata`, requis par l'injection de dépendances
  NestJS (voir docs/error-log.md, [2026-07-24] Injection de dépendances
  NestJS cassée sous Vitest)

## Structure du monorepo

```
apps/desktop     → application Electron (interface utilisateur)
apps/backend     → API NestJS (cloud)
packages/core    → logique métier partagée (calculs, règles de gestion)
                   TypeScript pur, sans dépendance Node ni navigateur
packages/db      → schéma Drizzle + migrations (Postgres uniquement)
packages/ui      → composants React partagés
```

## Conventions

- TypeScript strict partout. Pas de `any` sans commentaire justifiant pourquoi.
- Tables métier : UUID v7 (jamais d'auto-incrément), colonnes
  `created_at / updated_at / updated_by / version` obligatoires.
- Jamais de DELETE sur une table métier. Toujours `statut` + `archived_at`.
  Voir docs/data-dictionary.md pour les valeurs de statut valides par table.
- La logique métier (calculs financiers, révision de loyer, règles de gestion)
  vit exclusivement dans packages/core — jamais dupliquée dans apps/desktop
  ou apps/backend.
- Toute modification du schéma doit être répercutée dans
  docs/data-dictionary.md dans le même commit.
- Commits au format conventionnel : feat:, fix:, refactor:, docs:, test:

## Commandes

```
pnpm install         installer les dépendances
pnpm dev              lancer backend + desktop en parallèle
pnpm test             exécuter les tests (Vitest) sur tous les packages
pnpm lint             linter tout le monorepo
pnpm build            build de production
```

## Règles importantes — à ne jamais enfreindre

- Ne jamais appeler l'API Claude ou l'API Gmail directement depuis
  apps/desktop. Toujours passer par apps/backend (voir docs/app-spec.md,
  section Sécurité).
- Ne jamais stocker de secret (clé API, clé de chiffrement, mot de passe) en
  clair dans le code ou dans un fichier de config versionné.
- Avant de corriger un bug, vérifier s'il est déjà documenté dans
  docs/error-log.md.
- En cas d'ambiguïté sur une règle métier (calcul de charges, révision de
  loyer, régularisation) : demander plutôt que supposer. Ce sont des règles
  à valeur légale, pas des détails d'implémentation.
- Aucune fonctionnalité ne doit permettre la suppression définitive de
  données locataires, baux ou documents.

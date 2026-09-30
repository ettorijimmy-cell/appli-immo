# Image de production pour apps/backend (API NestJS).
#
# Contexte de build attendu : la RACINE du monorepo (pas apps/backend),
# car ce backend dépend de packages/core et packages/db via pnpm workspaces.
#   docker build -f apps/backend/Dockerfile -t appli-immo-backend .
#
# 5 étapes, pattern officiel Turborepo pour monorepo + Docker :
#   1. base      — image Node commune, corepack activé
#   2. pruner    — turbo prune : extrait le sous-ensemble minimal du monorepo
#                  nécessaire à "backend" (lockfile + package.json inclus)
#   3. installer — installe TOUTES les dépendances (dev incluses, requises
#                  pour builder : tsup, nest build...) puis build
#   4. prod-deps — installation séparée, PROD UNIQUEMENT, à partir du même
#                  squelette pruné — évite `pnpm prune --prod` après coup,
#                  qui casse les liens symboliques node_modules dans ce
#                  monorepo (testé : supprime aussi les liens des
#                  dépendances de prod, pas seulement celles de dev)
#   5. runner    — image finale : dist/ de l'étape 3 + node_modules de
#                  l'étape 4, sans aucun outil de build

FROM node:24-bookworm-slim AS base
RUN corepack enable

# --- Étape pruner --------------------------------------------------------
FROM base AS pruner
WORKDIR /app
RUN corepack prepare pnpm@11.17.0 --activate
COPY . .
RUN pnpm dlx turbo@^2.3.0 prune backend --docker

# --- Étape installer -------------------------------------------------------
FROM base AS installer
WORKDIR /app
RUN corepack prepare pnpm@11.17.0 --activate
# argon2 (dépendance native) peut nécessiter une compilation depuis les
# sources si aucun binaire précompilé ne correspond à l'image — outils de
# compilation en filet de sécurité, absents de l'image finale (étape
# séparée du runner).
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

# Squelette de fichiers (package.json de chaque workspace + lockfile) —
# copié séparément du code source pour que Docker mette en cache
# `pnpm install` tant que les dépendances ne changent pas.
COPY --from=pruner /app/out/json/ .
RUN pnpm install --frozen-lockfile

# Code source complet du sous-ensemble prune (backend + core + db)
COPY --from=pruner /app/out/full/ .
# tsconfig.base.json (extends racine, hérité par packages/core et
# packages/db) — turbo prune ne copie que les package.json/turbo.json/
# lockfile qu'il connaît, pas les fichiers de config partagée custom.
COPY tsconfig.base.json ./
ENV NODE_ENV=production
RUN pnpm turbo run build --filter=backend

# --- Étape prod-deps ---------------------------------------------------
FROM base AS prod-deps
WORKDIR /app
RUN corepack prepare pnpm@11.17.0 --activate
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY --from=pruner /app/out/json/ .
RUN pnpm install --prod --frozen-lockfile

# --- Étape runner ----------------------------------------------------------
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN groupadd --system --gid 1001 nestjs \
    && useradd --system --uid 1001 --gid nestjs nestjs

COPY --from=prod-deps --chown=nestjs:nestjs /app/node_modules ./node_modules
COPY --from=prod-deps --chown=nestjs:nestjs /app/apps/backend/node_modules ./apps/backend/node_modules
# packages/core n'a aucune dépendance de production (TypeScript pur, voir
# CLAUDE.md) — pas de node_modules généré pour ce workspace, rien à copier.
COPY --from=prod-deps --chown=nestjs:nestjs /app/packages/db/node_modules ./packages/db/node_modules
COPY --from=installer --chown=nestjs:nestjs /app/apps/backend/dist ./apps/backend/dist
COPY --from=installer --chown=nestjs:nestjs /app/apps/backend/package.json ./apps/backend/package.json
COPY --from=installer --chown=nestjs:nestjs /app/packages/core/dist ./packages/core/dist
COPY --from=installer --chown=nestjs:nestjs /app/packages/core/package.json ./packages/core/package.json
COPY --from=installer --chown=nestjs:nestjs /app/packages/db/dist ./packages/db/dist
COPY --from=installer --chown=nestjs:nestjs /app/packages/db/package.json ./packages/db/package.json

USER nestjs
EXPOSE 3000

CMD ["node", "apps/backend/dist/main.js"]

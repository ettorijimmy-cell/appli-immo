# Image de production pour apps/backend (API NestJS), qui embarque aussi le
# build de apps/mobile-web (servi sous /mobile/ par le backend lui-même,
# voir src/mobile-web/ — hébergement sous-chemin, pas un conteneur séparé).
#
# Contexte de build attendu : la RACINE du monorepo (pas apps/backend),
# car ce backend dépend de packages/core et packages/db via pnpm workspaces.
#   docker build -f apps/backend/Dockerfile -t appli-immo-backend .
#
# 5 étapes, pattern officiel Turborepo pour monorepo + Docker :
#   1. base      — image Node commune, corepack activé
#   2. pruner    — turbo prune : extrait le sous-ensemble minimal du monorepo
#                  nécessaire à "backend" ET "mobile-web" (lockfile et
#                  package.json des deux inclus — turbo prune accepte
#                  plusieurs cibles, un seul squelette pnpm cohérent pour
#                  les deux plutôt que deux prunes séparés)
#   3. installer — installe TOUTES les dépendances (dev incluses, requises
#                  pour builder : tsup, nest build, vite...) puis build des
#                  deux. mobile-web build SANS VITE_API_URL : absente du
#                  contexte Docker (.dockerignore exclut tout .env*), donc
#                  l'URL d'API retombe sur son défaut de production —
#                  relative, même origine (voir api-config.ts) — et sans
#                  MOBILE_WEB_BASE_PATH, donc "/mobile/" par défaut
#                  (vite.config.ts) : exactement l'hébergement sous-chemin
#                  voulu, sans variable à fournir au build de cette image.
#   4. prod-deps — installation séparée, PROD UNIQUEMENT, à partir du même
#                  squelette pruné — évite `pnpm prune --prod` après coup,
#                  qui casse les liens symboliques node_modules dans ce
#                  monorepo (testé : supprime aussi les liens des
#                  dépendances de prod, pas seulement celles de dev)
#   5. runner    — image finale : dist/ de l'étape 3 (backend + le build
#                  mobile-web, copié à côté de main.js sous
#                  mobile-web-dist/, chemin attendu par main.ts) +
#                  node_modules de l'étape 4, sans aucun outil de build

FROM node:24-bookworm-slim AS base
RUN corepack enable

# --- Étape pruner --------------------------------------------------------
FROM base AS pruner
WORKDIR /app
RUN corepack prepare pnpm@11.17.0 --activate
COPY . .
RUN pnpm dlx turbo@^2.3.0 prune backend mobile-web --docker

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
RUN pnpm turbo run build --filter=backend --filter=mobile-web

# --- Étape prod-deps ---------------------------------------------------
FROM base AS prod-deps
WORKDIR /app
RUN corepack prepare pnpm@11.17.0 --activate
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY --from=pruner /app/out/json/ .
# --filter=backend... : backend + ses propres dépendances (donc core/db au
# passage), JAMAIS mobile-web — cette étape ne fournit que le
# node_modules copié dans le runner (ligne COPY ci-dessous), jamais le
# build mobile-web lui-même (fichiers statiques déjà bundlés, aucune
# dépendance runtime, voir étape runner). Sans ce filtre, react-dom et
# react-router-dom (dépendances de production de mobile-web, jamais
# utilisées côté serveur) se retrouvaient installés et copiés pour rien —
# vérifié par un vrai build : ~4,5 Mo de react-dom dans l'image finale
# avant ce filtre, absent après.
RUN pnpm install --prod --frozen-lockfile --filter=backend...

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
# Build mobile-web, à côté de main.js compilé — chemin attendu par
# main.ts (join(__dirname, "mobile-web-dist")). Pas de node_modules à
# copier : fichiers statiques déjà bundlés par Vite, servis directement
# par express.static (voir src/mobile-web/), aucune dépendance runtime.
COPY --from=installer --chown=nestjs:nestjs /app/apps/mobile-web/dist ./apps/backend/dist/mobile-web-dist

USER nestjs
EXPOSE 3000

CMD ["node", "apps/backend/dist/main.js"]

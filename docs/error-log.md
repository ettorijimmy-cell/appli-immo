# Journal d'erreur

Objectif : éviter de retomber deux fois dans le même piège, et donner à
Claude Code une mémoire des problèmes déjà résolus sur ce projet — un bug
similaire dans un module différent se résout souvent de la même façon.

À consigner : tout bug non trivial, toute erreur qui a pris plus de
quelques minutes à diagnostiquer, tout comportement surprenant d'une
librairie (PowerSync, Drizzle, Electron en particulier).
Pas besoin de consigner une simple faute de frappe ou un oubli d'import.

## Format

Copier ce modèle pour chaque entrée, la plus récente en premier.

```
### [AAAA-MM-JJ] Titre court du problème

**Symptôme** : ce qui a été observé (message d'erreur, comportement inattendu)

**Contexte** : module concerné, ce qui était en cours de développement

**Cause** : la cause réelle, une fois identifiée — pas juste le correctif

**Solution** : ce qui a résolu le problème

**Fichiers concernés** : chemins des fichiers modifiés

**À surveiller** : si le problème peut resurgir ailleurs dans le code
```

---

## Entrées

### [2026-07-25] Guard JWT injectable dans un module mais pas dans un autre

**Symptôme** : `UnknownDependenciesException` au démarrage (ou à la
construction du TestingModule) — `Nest can't resolve dependencies of the
JwtAuthGuard (?). Please make sure that the argument JwtService at index
[0] is available in the XyzModule module.` Le message cible un module
précis (ex. `ComptesBancairesSciModule`) qui n'importe même pas
explicitement `AuthModule` ; un autre module utilisant exactement le même
`@UseGuards(JwtAuthGuard)` (ex. `ScisModule`) démarre sans problème.

**Contexte** : Module 1 (SCI), ajout de `ScisController` et
`ComptesBancairesSciController`, tous deux protégés par
`@UseGuards(JwtAuthGuard)`. Reproduit à la fois dans le TestingModule
(`scis.integration.spec.ts`) et dans le vrai serveur démarré via
`NestFactory.create(AppModule)` — ce n'est donc pas un artefact du
harnais de test.

**Cause** : `AuthModule` exportait `JwtAuthGuard` mais pas `JwtService`
(ni le `JwtModule` qui le fournit). Exporter une classe n'exporte pas
transitivement ses propres dépendances internes. Quand Nest a besoin de
(re)construire une instance de `JwtAuthGuard` pour un module consommateur,
il lui faut aussi que `JwtService` soit résolvable depuis ce module —
sinon la construction échoue, et l'échec est attribué au module
consommateur (pas à `AuthModule`), ce qui égare le diagnostic. Passer
`AuthModule` en `@Global()` seul n'a pas suffi : `@Global()` ne rend
disponibles que les exports du module marqué global, pas ceux de ses
propres imports non ré-exportés.

**Solution** : capturer l'instance de `JwtModule.registerAsync(...)` dans
une variable et l'ajouter à la fois à `imports` et à `exports` d'
`AuthModule` (en plus de `JwtAuthGuard`), pour que `JwtService` soit
transitivement disponible partout où `AuthModule` est accessible.
Combiné à `@Global()` sur `AuthModule`, tout futur module protégé par
`@UseGuards(JwtAuthGuard)` fonctionne sans rien importer explicitement.

**Fichiers concernés** : `apps/backend/src/auth/auth.module.ts`.

**À surveiller** : si un jour un guard/intercepteur/pipe exporté d'un
module a lui-même des dépendances non triviales, vérifier que TOUTES ses
dépendances (pas seulement la classe elle-même) sont exportées par le
module d'origine — sinon le même symptôme resurgira, avec un message
d'erreur qui pointe vers le mauvais module (le consommateur, pas
l'origine du problème). Toujours vérifier contre le vrai serveur démarré
en plus du TestingModule avant de conclure qu'un correctif fonctionne.

### [2026-07-24] Injection de dépendances NestJS cassée sous Vitest

**Symptôme** : dans un test utilisant `Test.createTestingModule(...)` (NestJS
Testing), un service injecté par type implicite dans un constructeur
(`constructor(private readonly usersService: UsersService)`, sans
`@Inject()` explicite) est `undefined` à l'exécution — erreur
`TypeError: Cannot read properties of undefined (reading '...')` sur le
premier appel à une méthode de ce service.

**Contexte** : premier test d'intégration réel (`auth.integration.spec.ts`,
Module 0) construisant un `AuthService` via un vrai `TestingModule`
NestJS plutôt qu'en l'instanciant à la main.

**Cause** : Vitest transforme le TypeScript via esbuild (transform Vite),
qui n'émet pas `emitDecoratorMetadata`. NestJS s'appuie sur les métadonnées
`design:paramtypes` (émises par `tsc` avec `emitDecoratorMetadata: true`)
pour résoudre les types de paramètres de constructeur non annotés par
`@Inject()`. Sans ces métadonnées, le conteneur DI ne sait pas quoi
injecter. Les tests unitaires classiques (instanciation manuelle
`new AuthService(usersService, jwtService)`) ne sont pas affectés, seuls
les tests passant par le conteneur DI de NestJS le sont.

**Solution** : ajouter `unplugin-swc` + `@swc/core` comme plugin Vite dans
la config Vitest du package concerné, à la racine du package (pas dans un
sous-dossier de module) pour que ça s'applique automatiquement à tout
futur module. `unplugin-swc` lit `experimentalDecorators` /
`emitDecoratorMetadata` depuis le `tsconfig.json` du package et les
respecte, contrairement à esbuild.

**Fichiers concernés** : `apps/backend/vitest.config.ts`,
`apps/backend/vitest.integration.config.ts`, `apps/backend/package.json`
(devDependencies `unplugin-swc`, `@swc/core`), `pnpm-workspace.yaml`
(`allowBuilds.'@swc/core'`).

**À surveiller** : ce n'est pas un problème propre au module auth — c'est
un problème de configuration Vitest au niveau du package apps/backend tout
entier. N'importe quel futur module NestJS testé via
`Test.createTestingModule` (ex. finances, documents, alertes...) aurait le
même symptôme si la config Vitest utilisée ne chargeait pas ce plugin. Le
correctif est déjà au bon niveau (vitest.config.ts et
vitest.integration.config.ts à la racine d'apps/backend, pas dans
src/auth/), donc aucune action requise à la création d'un nouveau module —
mais si quelqu'un crée un jour une config Vitest supplémentaire (par
module, par exemple) sans repartir de celles-ci, le bug resurgira
silencieusement.

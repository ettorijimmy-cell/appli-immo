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

### [2026-07-29] Navigation sidebar bloquée depuis une fiche profonde (Patrimoine, Locataires)

**Symptôme** : depuis une fiche imbriquée (SCI → Immeuble → Appartement, ou
fiche Locataire), cliquer sur une autre entrée de la sidebar (ex. Tableau
de bord) ne déclenchait aucune navigation. Il fallait remonter
manuellement la hiérarchie jusqu'au niveau liste avant qu'un changement de
section fonctionne à nouveau. Confirmé systémique : touchait tout écran
avec un état de navigation en profondeur (pas seulement Patrimoine).

**Contexte** : Module 7, finalisation du fil d'Ariane
(`breadcrumb-context.tsx`) sur les fiches `SciDetailView`,
`ImmeubleDetailView`, `AppartementDetailView`, `LocataireDetailView`.

**Cause** : boucle de rendu infinie dans `useBreadcrumbSegments`. Son effet
dépendait de `ctx` (l'objet de contexte entier), que `BreadcrumbProvider`
recrée (`useMemo`) à chaque changement de `segments`. Séquence : l'effet
appelle `setSegments(segments)` → nouvel objet `ctx` → la fiche se re-rend
avec ce nouveau `ctx` → dépendance d'effet changée → nettoyage
(`setSegments([])`) → nouvel objet `ctx` → effet redéclenché →
`setSegments(segments)` → … Boucle continue tant qu'une fiche appelant ce
hook restait montée, saturant le thread JS au point de rendre les clics
(y compris sidebar) pratiquement impossibles à faire aboutir. La boucle ne
s'arrêtait que quand le composant se démontait — donc uniquement en
remontant jusqu'au niveau liste, seul niveau qui n'appelle pas ce hook.

**Solution** : dépendre de `ctx?.setSegments` (identité stable, issue de
`useState`) plutôt que de `ctx` lui-même dans le tableau de dépendances de
l'effet.

**Fichiers concernés** :
`apps/desktop/src/renderer/src/layout/breadcrumb-context.tsx`

**À surveiller** : tout futur hook consommant `BreadcrumbContext` (ou tout
autre contexte dont la valeur est recréée via `useMemo` sur un état qu'un
effet consommateur modifie lui-même) doit dépendre des fonctions stables
extraites du contexte, jamais de l'objet de contexte entier.

### [2026-07-27] Confirmation d'un rapprochement CSV échouait en 400 (virgule décimale)

**Symptôme** : cliquer sur "Confirmer ce rapprochement" (import CSV,
Finances) échouait systématiquement avec `ApiError: Requête échouée (400)`
— aucun détail affiché dans l'app.

**Contexte** : Module 5 (Finances), écran de rapprochement bancaire, test
manuel réel avec un fichier CSV au format bancaire français (virgule
décimale, ex. `850,00`).

**Cause** : `EnregistrerPaiementDto.montantPaye` portait `@IsNumberString()`
sans option de locale — `validator.isNumeric` n'accepte par défaut que le
point comme séparateur décimal, jamais la virgule (vérifié empiriquement :
`isNumeric("850,00")` → `false`, `isNumeric("850,00", {locale:"fr-FR"})` →
`true`). `RapprochementCsvView.tsx` transmettait le montant de la ligne CSV
tel quel, sans normalisation — le format français bancaire que le parseur
CSV est censé absorber n'était en réalité jamais converti sur le chemin
`montantPaye`. Effet de bord découvert au passage : `authenticated-fetch.ts`
(`extraireMessageErreur`) ne gérait que `message` en tant que chaîne, alors
que NestJS renvoie un tableau de chaînes par défaut sur un rejet de
`ValidationPipe` — d'où l'absence totale de détail dans l'app.

**Solution** : extraire la normalisation virgule/point/espaces déjà
présente dans `montantEnCentimes` en une fonction exportée
`normaliserMontant` (`packages/core`), seule définition de "comment
interpréter un montant en euros" dans tout le code. Appelée aux deux
endroits où un montant entre dans le système : `RapprochementCsvView.tsx`
avant l'appel à `enregistrerPaiement`, et un `@Transform` (class-transformer)
sur les 3 DTO paiements (`create`/`update`/`enregistrer`), exécuté avant
`@IsNumberString()`. `apps/desktop` dépend désormais de `packages/core`
(`workspace:*`) — première consommation directe du package par le
renderer, jusqu'ici uniquement utilisé par `apps/backend`.

**Fichiers concernés** : `packages/core/src/paiements/montant.ts`,
`apps/backend/src/paiements/dto/{create,update,enregistrer}-paiement.dto.ts`,
`apps/desktop/src/renderer/src/finances/RapprochementCsvView.tsx`,
`apps/desktop/package.json`.

**À surveiller** : tout futur champ montant (Charges, Travaux...) doit
passer par `normaliserMontant` des deux côtés (DTO + tout appelant
frontend qui construit lui-même la valeur, pas juste un champ de
formulaire HTML `type="number"` qui produit toujours un point). Par
ailleurs, `authenticated-fetch.ts` ne remonte toujours pas un `message`
sous forme de tableau (cas `ValidationPipe`) — un futur bug de validation
DTO redonnera le même symptôme trompeur ("Requête échouée (4xx)" sans
détail) tant que ce n'est pas corrigé séparément.

### [2026-07-26] CSP bloquait le login Electron ("Identifiants invalides" trompeur)

**Symptôme** : le login échouait systématiquement avec "Identifiants
invalides", laissant croire à un problème de mot de passe/Argon2. La
vraie cause, visible uniquement dans les DevTools du renderer : "Fetch
API cannot load http://localhost:3000/auth/login. Refused to connect
because it violates the document's Content Security Policy."

**Contexte** : écran de connexion Electron (Module 0), premier essai de
connexion réel après mise en place du Postgres de dev persistant.

**Cause** : la CSP (`default-src 'self'; script-src 'self'`) n'avait pas
de `connect-src` explicite ; `default-src 'self'` s'appliquait donc en
repli et bloquait tout fetch vers une origine différente de celle du
document (le backend sur `localhost:3000`).

**Solution** : ajouter `connect-src 'self' <origine backend>` à la CSP,
paramétré via `VITE_API_URL` (même variable que
`lib/api-config.ts`) plutôt que codé en dur. CSP différenciée dev/prod
(`electron.vite.config.ts`) car le client HMR de Vite a en plus besoin de
`style-src 'unsafe-inline'` en dev uniquement (jamais présent en
production).

Correctif appliqué en deux temps : un premier correctif (regex sur la
balise `<meta>` dans `transformIndexHtml`) a lui-même échoué
silencieusement à cause d'une mise en forme multi-ligne de la balise
source, avant d'être remplacé par un placeholder littéral (`__CSP__`)
recherché par simple correspondance de chaîne, avec échec bruyant du
build si le placeholder est absent.

**Fichiers concernés** : `apps/desktop/src/renderer/index.html`,
`apps/desktop/electron.vite.config.ts`, `.env.example`.

**À surveiller** : tout futur module ajoutant un nouvel appel réseau
depuis le renderer (pas seulement vers le backend — tout `fetch`/XHR/
WebSocket) devra vérifier que l'origine appelée est bien whitelistée
dans `connect-src`, sous peine du même symptôme trompeur. Si un jour une
nouvelle origine backend doit être autorisée (ex. Scaleway en
production), il suffit de renseigner `VITE_API_URL` — ne jamais coder
une origine en dur dans la CSP. Plus généralement : un échec applicatif
côté renderer (ici "Identifiants invalides") peut être un faux symptôme
qui cache un blocage réseau, jamais un vrai problème d'authentification
— vérifier la console DevTools du renderer avant de suspecter la logique
métier (ici Argon2/le hash).

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

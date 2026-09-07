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

### [2026-09-07] ImportCsvDepensesView proposait les lignes de crédit comme candidates de dépense

**Symptôme** : confirmé par test manuel Electron — dans l'écran d'import
CSV du module Dépenses, une ligne de crédit (encaissement, montant positif
dans le CSV parsé) était affichée avec les mêmes sélecteurs catégorie/
rattachement et le même bouton "Créer cette dépense" actif qu'une ligne de
débit. Un encaissement (remboursement, virement reçu) aurait donc pu être
créé comme une dépense.

**Contexte** : Module Charges et fiscalité, Étape 1 (import CSV dépenses).
Le besoin de filtrer les lignes au signe négatif avait été identifié
explicitement pendant l'audit préalable de cette étape ("il faut filtrer
aux lignes négatives... dans le nouveau flux dépenses, pas dans
`parserReleveCsv`"), mais ce filtrage n'avait en réalité jamais été codé
dans `ImportCsvDepensesView.tsx` — chaque ligne, quel que soit son signe,
recevait le même rendu actionnable.

**Cause** : absence totale de vérification du signe du montant avant
d'afficher les contrôles de création dans la boucle de rendu des lignes
CSV — un oubli d'implémentation malgré l'intention documentée au moment de
l'audit.

**Solution** : ajout de `estMontantNegatif` (packages/core, manipulation
purement textuelle du signe, même famille que `valeurAbsolueMontant`).
`ImportCsvDepensesView` calcule `estDebit = estMontantNegatif(ligne.montant)`
pour chaque ligne : seules les lignes de débit affichent les sélecteurs et
le bouton de création ; les lignes de crédit affichent un message
"Encaissement (crédit) — non applicable à une dépense", jamais masquées
silencieusement (cohérent avec le reste de l'interface, qui montre toujours
toutes les lignes du CSV). Garde-fou supplémentaire dans
`handleConfirmer` : retourne immédiatement si la ligne n'est pas un débit,
même si l'état React permettait par erreur d'atteindre cette fonction.

**Fichiers concernés** :
`packages/core/src/paiements/montant.ts` (+ test),
`apps/desktop/src/renderer/src/depenses/ImportCsvDepensesView.tsx`.

**À surveiller** : toute future vue qui affiche des lignes de CSV brutes
côté dépenses doit répéter ce filtrage — il n'existe pas de composant
partagé qui l'appliquerait automatiquement. Le garde-fou backend
(`CreateDepenseDto` rejette un montant négatif, voir revue
financial-logic-reviewer du 2026-09-07 ci-dessus) empêcherait bien la
création effective si ce filtrage frontend venait à disparaître, mais
laisserait un bouton actif menant systématiquement à une erreur — pas
acceptable comme unique garde-fou, seulement en défense en profondeur.

### [2026-08-27] DELETE de nettoyage scopé par nom plutôt que par ID — bloqué par une contrainte FK, pas par une vérification préalable

**Symptôme** : en nettoyant les données de test créées pour vérifier de
bout en bout les scripts corrigés après la migration bien (dette
différée, seed-test-*.ts), un `DELETE FROM locataires WHERE id IN (...)
OR nom = 'Testeur' AND prenom = 'Loca'` a matché, en plus du locataire
jetable créé pour ce test, un second locataire réel préexistant portant
le même nom/prénom. Postgres a rejeté la suppression de ce second
locataire avec `ERROR: update or delete on table "locataires" violates
foreign key constraint "bail_locataires_locataire_id_locataires_id_fk"`
(il restait référencé par un `bail_locataires` réel), ce qui a fait
échouer et annuler l'intégralité du bloc `DO $$ ... $$` (y compris les
suppressions déjà effectuées plus tôt dans le même bloc — état des lieux,
alertes, etc., toutes rollback atomiquement avec lui).

**Contexte** : vérification de bout en bout des scripts `seed-test-*.ts`
réécrits pour passer par `BienService`/`AppartementsService` (dette
différée de la migration bien, docs/backlog.md) — nettoyage d'une fixture
jetable (`SCI Verif Migration Bien`) après confirmation que chaque script
fonctionnait réellement.

**Cause** : la clause de nettoyage utilisait un critère par attribut
(`nom`/`prenom`) au lieu de se limiter aux IDs exacts effectivement créés
et déjà connus (imprimés par les scripts eux-mêmes). Rien dans ma propre
démarche n'a détecté le problème avant exécution — ni relecture de la
clause `WHERE`, ni dry-run. La suppression a réellement été envoyée à
Postgres ; seule une contrainte de clé étrangère côté base (comportement
par défaut `RESTRICT`, pas de `CASCADE` sur `bail_locataires_locataire_id_
locataires_id_fk`) a empêché la perte de données, et uniquement parce que
ce locataire précis était encore référencé ailleurs au moment exact de la
tentative — une coïncidence favorable, pas un garde-fou fiable.

**Solution** : nouvelle tentative de nettoyage scopée exclusivement sur
les IDs exacts capturés dans la sortie console des scripts (aucune clause
par nom/attribut), exécutée avec succès. Vérification après coup, sur les
28 tables potentiellement concernées, qu'aucune ligne de la fixture
jetable ne subsistait (le rollback atomique du bloc raté avait bien tout
annulé, y compris les suppressions antérieures dans le même bloc — pas de
données orphelines). Règle formalisée dans CLAUDE.md, section "Règles
importantes" : tout DELETE de nettoyage scopé exclusivement par ID exact,
jamais par attribut, jamais en bloc transactionnel unique sans relecture
préalable de la clause WHERE.

**Fichiers concernés** : aucun fichier de code (incident opérationnel lors
d'une vérification manuelle, pas un bug de code) — voir CLAUDE.md pour la
règle qui en découle.

**À surveiller** : toute future session de nettoyage de données de test
locales, en particulier quand les valeurs de test (noms, emails, marqueurs
littéraux) sont réutilisées d'un script à l'autre ou d'une session à
l'autre — le risque de collision par attribut existe précisément parce
que ces valeurs sont volontairement stables et répétées.

### [2026-08-11] Le préfixe SCW_ est réservé par Scaleway — inutilisable pour des secrets applicatifs

**Symptôme** : le formulaire de création de secret Serverless Containers,
dans la console Scaleway, refuse toute variable dont le nom commence par
`SCW_` avec le message "SCW_* is a prefix reserved by Scaleway", repéré
avant toute saisie grâce à la vérification préalable demandée par
l'utilisateur (voir consigne standing : confirmer chaque étape de
configuration de production avant d'agir).

**Contexte** : hébergement backend (étape 5, déploiement Serverless
Containers) — les trois secrets pilotant le backend Object Storage du
Module 4 avaient été nommés `SCW_ACCESS_KEY`/`SCW_SECRET_KEY`/
`SCW_BUCKET_NAME`, par cohérence avec `DATABASE_URL` (bascule dev/prod).

**Cause** : Scaleway réserve tout le préfixe `SCW_` à sa propre
configuration produit (ex. validation de token) sur Serverless Containers
— confirmé à la fois par le message du formulaire et par la documentation
Scaleway (recherche web, pas de mémoire). Ce n'est pas limité aux
variables auto-injectées comme `SCW_REGION` : toute variable utilisateur
du même préfixe est rejetée à la création.

**Solution** : renommage des trois variables, dans le code et partout où
elles sont documentées, sans préfixe `SCW_` :
`OBJECT_STORAGE_ACCESS_KEY`/`OBJECT_STORAGE_SECRET_KEY`/
`OBJECT_STORAGE_BUCKET_NAME`. Les valeurs elles-mêmes restent les
identifiants Scaleway (Access Key/Secret Key) — seul le nom de la
variable d'environnement change.

**Fichiers concernés** : `apps/backend/src/documents/storage/
document-storage.service.ts`, `.env.example`, `docs/data-dictionary.md`,
`docs/integrations.md`, cette entrée et l'entrée du 2026-08-11 sur
`turbo.json`/`globalEnv` (exemple de joker mis à jour).

**À surveiller** : toute future variable d'environnement liée à
Scaleway (ex. si un jour une clé API Scaleway distincte est introduite)
doit être nommée sans le préfixe `SCW_`, quel que soit le produit
Scaleway concerné (pas seulement Serverless Containers — la réservation
est documentée au niveau plateforme).

### [2026-08-11] La vraie cause racine : Turborepo ne transmettait pas DATABASE_URL à test:integration

**Résout définitivement les trois entrées précédentes du 2026-08-11 et
celle du 2026-08-10.** `begin()` qui bloquait et `afterEach` qui masquait
l'erreur (voir entrée suivante) étaient de vrais bugs, corrigés à juste
titre — mais ni l'un ni l'autre n'était LA cause du premier échec CI.
Celle-ci ne pouvait être trouvée qu'en reproduisant *exactement* la
commande que `ci.yml` exécute (`pnpm test:integration` depuis la racine
du dépôt, donc via `turbo run test:integration`) — jamais fait avant
cette entrée : toutes les tentatives précédentes lançaient `vitest`
directement ou depuis `apps/backend`, contournant Turborepo.

**Symptôme réel, confirmé par reproduction locale exacte** :
`DATABASE_URL='postgres://bogus@127.0.0.1:1/x' pnpm test:integration`
(depuis la racine) fait passer les 139 tests — la valeur bogus n'est
**jamais lue**. Turborepo, sans déclaration explicite dans `turbo.json`,
ne transmet pas une variable d'environnement arbitraire au processus
enfant qu'il lance pour `test:integration` : `process.env.DATABASE_URL`
vaut `undefined` côté vitest, et `packages/db/src/client.ts` retombe
silencieusement sur `DEFAULT_DEV_DATABASE_URL` (port 5433). En CI, rien
n'écoute sur ce port (le service Postgres de `ci.yml` est sur 5432) —
d'où `ECONNREFUSED 127.0.0.1:5433`. **Jamais reproduit dans les
nombreuses tentatives précédentes de cette investigation** parce que le
vrai Postgres de dev tournait réellement sur le port 5433 pendant toute
la session : le repli silencieux se connectait "par accident" à une vraie
base (la mauvaise, mais joignable), masquant totalement le problème.
`db:migrate` et `pnpm seed:inventaire-meuble` (lancés en `pnpm` direct,
jamais via `turbo run`) recevaient `DATABASE_URL` normalement — d'où leur
succès systématique en CI, qui a longtemps détourné le diagnostic vers
autre chose que Turborepo.

**Effet de bord découvert pendant la reproduction** : avec une URL
réellement injoignable (au lieu d'un simple repli vers un port fermé),
le processus worker Vitest (Tinypool) plante entièrement — `Unhandled
'error' event` sur le socket bas niveau du client `postgres`, hors de
portée d'un `try/catch` applicatif — plutôt que de faire échouer les
tests un par un proprement. Ceci explique le dernier run CI en échec
observé après les deux correctifs précédents : aucune annotation
individuelle par test, seulement "Process completed with exit code 1"
— le worker entier s'est arrêté avant que Vitest ne puisse générer son
rapport normal. Ce plantage ne se produit qu'en cas d'échec de connexion
réel ; une fois `DATABASE_URL` correctement transmise vers un Postgres
réellement joignable (le cas normal en CI une fois ce correctif posé),
il ne se déclenche pas.

**Solution** : `globalEnv: ["DATABASE_URL"]` ajouté à `turbo.json`.
Vérifié par reproduction exacte de la commande CI (`pnpm test:integration`
depuis la racine) : une URL bogue explicite provoque désormais une vraie
erreur de connexion (au lieu d'un repli silencieux réussi), et une URL
valide vers une base fraîchement créée et nommée distinctement (jamais
utilisée ailleurs dans cette session, pour exclure toute coïncidence)
fait passer les 139 tests.

**Fichiers concernés** : `turbo.json`.

**À surveiller — confirmé, pas une supposition (2026-08-11, après coup)** :
`npx turbo run test --filter=backend --dry=json` affiche
`"envMode": "strict"` (mode par défaut de cette version de Turborepo,
jamais surchargé dans `turbo.json`) et, pour chaque tâche,
`"specified": { "env": ["DATABASE_URL"], "passThroughEnv": null }` — donc
**aucun mécanisme automatique** ne transmet une variable non déclarée,
seule `DATABASE_URL` est laissée passer aujourd'hui. Concrètement : le
jour où un module ajoute de vrais tests d'intégration contre le bucket
Object Storage réel en CI (`OBJECT_STORAGE_ACCESS_KEY`/
`OBJECT_STORAGE_SECRET_KEY`/`OBJECT_STORAGE_BUCKET_NAME`, ou toute autre
variable future dont dépend un `run:` de `ci.yml` délégué à `turbo run` —
pas seulement `test:integration`, `build`/`test`/`dev` y sont tout aussi
exposés), il faudra l'ajouter
explicitement à `globalEnv` dans `turbo.json` (ou au tableau `env` de la
tâche concernée si elle ne doit pas être globale) — sinon exactement le
même repli silencieux vers une valeur de dev locale se reproduira, avec
le même effet masquant en local tant qu'un service du même nom écoute
par coïncidence sur le port/l'identifiant par défaut. Turborepo accepte
un joker en suffixe (`"OBJECT_STORAGE_*"`) si plusieurs variables du même
préfixe doivent être ajoutées d'un coup — pas de correspondance partielle
ailleurs qu'en fin de chaîne.

### [2026-08-11] Vraie cause trouvée : begin() bloquait pour toujours en cas d'échec de connexion (transactional-test.ts)

**Résout l'entrée précédente ([2026-08-10]) — le diagnostic initial était
faux : ce n'était pas isolé à `alertes.integration.spec.ts`.** Deux
mauvaises pistes (hook timeout, contention inter-fichiers) ont été
essayées et réfutées par des runs CI réels avant celle-ci — voir le
tableau ci-dessous. Le fichier `.integration.spec.ts` sur lequel portait
le diagnostic ne comptait que pour 10 des ~50 annotations affichées par
l'API GitHub Checks (limite de pagination jamais vérifiée à l'époque) ;
**les 12 fichiers, 139 tests, échouaient en réalité tous identiquement**,
confirmé par le log brut complet téléchargé (pas l'API).

**Symptôme réel** : `TypeError: Cannot read properties of undefined
(reading 'close')` sur `await moduleRef.close();` dans `afterEach`,
répété à l'identique dans les 12 fichiers `*.integration.spec.ts`, sans
exception.

**Cause réelle, dans le helper partagé
`apps/backend/src/test-utils/transactional-test.ts`** : `begin()` retourne
une promesse (`ready`) qui n'est résolue que depuis l'INTÉRIEUR du
callback passé à `rootDb.transaction(callback)`, via `markReady(tx)`. Si
`rootDb.transaction(...)` échoue à établir la transaction AVANT même
d'invoquer ce callback (ex. connexion Postgres impossible), le rejet part
sur une chaîne de promesses complètement différente
(`transactionSettled`, alimentée par le `.catch()` du `.transaction(...)`)
que personne n'attend à ce moment-là — `rollback()` ne l'attend que plus
tard, dans `afterEach`, qui n'est jamais atteint puisque `beforeEach` est
toujours bloqué sur `await begin()`. Résultat : `ready` ne se résout
**ni ne rejette jamais** — `beforeEach` bloque indéfiniment sur
`db = await begin();`, sans même atteindre la ligne qui construit
`moduleRef`. D'où le symptôme : `moduleRef` reste à `undefined` pour
toujours, dans les 12 fichiers, puisqu'ils utilisent tous le même helper.
Jamais reproduit en local car ma connexion Postgres locale n'a jamais
échoué à s'établir dans aucune tentative — le chemin de blocage n'a donc
jamais été emprunté chez moi, quelle que soit la charge/le CPU simulés.

**Pourquoi les deux pistes précédentes ont semblé produire un effet sans
rien régler** : `hookTimeout: 30000` a retardé l'échec (Vitest finissait
par abandonner le hook bloqué après 30 s au lieu de 10 s) sans jamais le
corriger — c'est la fuite de promesse elle-même, pas le délai, qui était
en cause. La sérialisation (`singleThread`) n'avait aucune raison d'avoir
un effet, puisque le blocage ne dépend d'aucune concurrence entre
fichiers — chaque fichier bloque pour la même raison, seul, l'un après
l'autre.

**Solution** : `begin()` capture désormais aussi la fonction `reject` de
`ready` (`markFailed`). Si `rootDb.transaction(...)` rejette pour une
raison autre que le `RollbackSignal` interne, `begin()` rejette
immédiatement avec la vraie erreur au lieu de bloquer. Sans effet si
`ready` est déjà résolue (un `reject()` après un `resolve()` est un
no-op standard des Promise JS). Testé par reproduction exacte du
scénario (un faux `rootDb.transaction` qui rejette avant d'appeler son
callback) dans `apps/backend/src/test-utils/transactional-test.spec.ts` —
confirme que `begin()` rejette avec la vraie erreur au lieu de bloquer,
et que `rollback()` (appelé depuis `afterEach` même quand `beforeEach` a
déjà jeté) l'expose une seconde fois proprement, sans rejet non
intercepté.

**Ce qui reste à découvrir** : ce correctif fait remonter la vraie erreur
au lieu de la masquer par un blocage — il ne dit pas *pourquoi*
`rootDb.transaction(...)` échouait à se connecter sur le runner GitHub
Actions. La prochaine exécution CI en échec (s'il y en a une) affichera
désormais le vrai message d'erreur Postgres/réseau directement dans les
annotations, sans qu'il faille retourner chercher dans un log brut.

**Fichiers concernés** :
`apps/backend/src/test-utils/transactional-test.ts`,
`apps/backend/src/test-utils/transactional-test.spec.ts` (nouveau).

**À surveiller** : tout futur helper de test qui résout une promesse
depuis l'intérieur d'un callback asynchrone (pattern "défère la
résolution à un événement interne") doit systématiquement aussi câbler le
chemin d'échec vers la même promesse — sinon le même type de blocage
silencieux, indiscernable d'un vrai timeout ou d'une erreur applicative,
peut resurgir ailleurs.

| Piste | Testée comment | Résultat |
|---|---|---|
| Hook Vitest trop court | `hookTimeout: 30000`, run CI réel observé | Retardait l'échec de ~24 min, ne le corrigeait pas |
| Contention inter-fichiers | Suite sérialisée, run CI réel observé | Aucun effet — même échec en isolation totale |
| **`begin()` ne propage pas l'échec de connexion** | Bug lu directement dans le code, test unitaire dédié qui reproduit le scénario exact | **Cause confirmée et corrigée** |

### [2026-08-10] CI jamais poussé sur GitHub — deux écarts local/CI découverts au premier vrai run

**Symptôme** : deux bugs distincts, jamais détectés jusqu'ici :
1. `apps/backend/src/documents/storage/document-storage.service.ts`
   (service de stockage local des documents, utilisé depuis le Module 4)
   n'avait jamais été commité — code réellement en usage, invisible à git.
2. Sur un Postgres fraîchement migré (sans base de dev déjà seedée), 3
   tests d'intégration échouent : `getCatalogueInventaire()` attend 88
   lignes et en trouve 0, `submitInventaire()` échoue à la même cause, et
   la génération du docx état des lieux ne trouve pas "ÉLECTRO-MÉNAGER"
   dans le texte produit (conséquence en cascade du catalogue vide).

**Contexte** : 70 commits locaux accumulés sur plusieurs semaines de
développement (tous les modules du MVP), jamais poussés vers
`origin/main` — resté au tout premier commit du dépôt
(`chore: ajout du .gitignore`). Le pipeline CI (`.github/workflows/ci.yml`,
déclenché `on: push`/`pull_request`) n'avait donc *jamais tourné pour de
vrai* sur ce projet, malgré des dizaines d'entrées de backlog/tâches
mentionnant "pipeline complet" — ce "pipeline complet" n'a toujours
désigné que les commandes `pnpm lint`/`typecheck`/`test`/`test:integration`
exécutées localement, jamais une exécution GitHub Actions réelle.

**Cause (bug 1)** : `.gitignore` contenait un motif non ancré `storage/`,
destiné à exclure `apps/backend/storage/` (blobs de documents chiffrés,
données réelles) mais qui excluait en réalité TOUT dossier nommé
`storage/` dans le dépôt, y compris `apps/backend/src/documents/storage/`
(code source). Le fichier existait et tournait localement (le système de
fichiers ne se soucie pas de ce que git suit), donc jamais repéré — un
`git clone` frais (ce que fait tout runner CI) ne l'aurait jamais eu, et
`documents.service.ts` aurait échoué au typecheck immédiatement.

**Cause (bug 2)** : `elements_inventaire_meuble` (catalogue de 88 éléments
d'inventaire meublé) n'est peuplée que par le script
`pnpm seed:inventaire-meuble`, jamais appelé automatiquement — ni par les
migrations Drizzle, ni par `ci.yml`. En local, la base de dev
(`appli_immo_dev`, port 5433) avait été seedée une fois manuellement des
semaines plus tôt et n'a plus jamais été recréée depuis, masquant
totalement la dépendance. Un Postgres neuf (le service éphémère de CI, ou
n'importe quel nouvel environnement) migre les tables mais ne les peuple
jamais de données de référence.

**Solution** :
1. `.gitignore` : motif ancré `/apps/backend/storage/` au lieu de
   `storage/` (commit séparé, avant tout autre changement).
   `document-storage.service.ts` récupéré dans un commit dédié, contenu
   identique à celui réellement en usage.
2. `.github/workflows/ci.yml` : nouvelle étape `pnpm seed:inventaire-meuble`
   entre les migrations et `pnpm test:integration`.
3. Les deux correctifs vérifiés par reproduction réelle : conteneur
   Postgres jetable (`docker run postgres:16`, base neuve), migrations
   appliquées, `test:integration` lancé — échec reproduit à l'identique de
   ce que CI a montré, puis confirmé résolu après le seed, avant de
   pousser le correctif.

**Fichiers concernés** : `.gitignore`,
`apps/backend/src/documents/storage/document-storage.service.ts`,
`.github/workflows/ci.yml`.

**À surveiller** : ce projet a maintenant un vrai historique de CI passé
au vert — ne plus jamais accumuler des dizaines de commits locaux sans
pousser. Pour toute nouvelle table de référence/catalogue seedée
manuellement en local (sur le modèle d'`elements_inventaire_meuble`),
vérifier explicitement qu'un test d'intégration qui en dépend échoue bien
sur un Postgres neuf, jamais seulement sur la base de dev locale
persistante — sinon le même piège se reproduira silencieusement à chaque
nouvelle table de ce genre.

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

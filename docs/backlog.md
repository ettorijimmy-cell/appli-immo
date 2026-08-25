# Backlog — MVP

Découpage du périmètre MVP en modules ordonnés par dépendances. Chaque
module doit respecter la Definition of Done générale (docs/app-spec.md et
CLAUDE.md) : TypeScript strict, tests packages/core pour toute règle
métier, docs/data-dictionary.md à jour si le schéma change.

Taille estimée indicative : S (quelques jours) / M (environ une semaine) /
L (une à deux semaines) — sert de base à la Phase 11 (Roadmap).

Graphe de dépendances : 0 → 1 → 2 → 3 → {4, 5} → 6 → 7 → 8

---

## Module 0 — Fondations techniques
**Taille : L — bloque tous les autres modules, à ne pas sous-estimer**

- Initialisation monorepo (pnpm workspaces + Turborepo)
- Provisionnement Scaleway : instance Postgres, bucket Object Storage,
  activation explicite de la réplication logique
- Schéma Drizzle initial : `organisations`, `organisation_sci`,
  `utilisateurs`, `journal_audit`
- Première migration
- Configuration PowerSync (Sync Streams de base) branchée sur Postgres —
  Sync Rules, mentionné à l'origine, est désormais qualifié de legacy par
  PowerSync ; Sync Streams est le mécanisme recommandé pour tout nouveau
  projet (voir docs/integrations.md)
- Squelette backend NestJS + module d'authentification (JWT + Argon2)
- Squelette Electron : fenêtre principale, `contextIsolation: true`,
  `nodeIntegration: false`, aucun contenu web distant
- Connexion Electron ↔ PowerSync (base locale SQLite chiffrée)
- Shell de navigation : sidebar à 6 entrées, fil d'Ariane, layout général
  (sans contenu métier)
- Écran de connexion
- Pipeline CI (lint/test/build)

**Critère de complétion** : un utilisateur peut se connecter, l'application
se lance hors ligne avec une base locale vide, la synchronisation avec le
cloud fonctionne dans les deux sens sur une table de test.

---

## Module 1 — SCI
**Taille : S**

- CRUD SCI (créer / modifier / archiver), champ `regime_fiscal` (IS/IR)
  explicite, jamais présupposé
- CRUD comptes bancaires SCI, avec chiffrement applicatif IBAN/BIC
- Rattachement automatique `organisation_sci` (role `proprietaire`) à la
  création d'une SCI
- Écran liste des SCI + fiche SCI

**Critère de complétion** : créer une SCI, lui associer un compte bancaire,
vérifier que l'IBAN n'apparaît jamais en clair en base.

**Écart connu — corrigé.** L'endpoint "modifier" du CRUD SCI listé
ci-dessus n'avait jamais été implémenté — seuls create / findAll /
findById / archiver existaient (`apps/backend/src/scis`). Identifié lors
du Module 2, qui avait implémenté le CRUD complet (dont "modifier") pour
Immeubles/Appartements/Équipements. Corrigé après coup (hors chronologie
des modules) : `PATCH /scis/:id` (`UpdateSciDto`, même pattern que
`UpdateImmeubleDto`) + bouton "Modifier" sur `SciDetailView.tsx`, testé
par un test d'intégration Postgres réel
(`scis.integration.spec.ts`). Le Module 1 est désormais fidèle à sa propre
définition.

---

## Module 2 — Patrimoine
**Taille : M**

- CRUD Immeubles (rattachés à une SCI)
- CRUD Appartements (rattachés à un immeuble), statut
  `vacant / loue / travaux / archive`
- CRUD Équipements (rattachés à un appartement)
- Écran Patrimoine : vue tableau filtrable par SCI / immeuble / statut
- Fiche appartement : onglets Infos et Équipements (les onglets Bail actuel
  et Historique arrivent avec le Module 3)

**Critère de complétion** : parcourir la hiérarchie SCI → immeuble →
appartement depuis l'écran Patrimoine sans naviguer par menus multiples.

---

## Module 3 — Locataires & Baux
**Taille : L**

- CRUD Locataires
- CRUD Garants (rattachés à un bail)
- CRUD Baux (rattachés à un appartement) + table de liaison
  `bail_locataires` pour la colocation
- Règle métier (packages/core) : pré-remplissage du loyer depuis
  `loyer_reference` de l'appartement à la création d'un bail
- Règle métier (packages/core) : passage automatique du statut appartement
  `vacant → loue` à l'activation d'un bail, et l'inverse à sa résiliation
- Fiche locataire complète : coordonnées, garants, bail en cours,
  historique des baux précédents (sections repliables, Phase 6)
- Complétion de la fiche appartement : onglets Bail actuel + Historique
  des baux

**Écart connu (revue financial-logic-reviewer)** : `activer()`
(`apps/backend/src/baux/baux.service.ts`) vérifie désormais directement la
table `baux` (pas seulement le champ miroir `appartements.statut`) pour
empêcher deux baux actifs simultanés sur le même appartement — corrigé
avant de considérer le module terminé. Deux points supplémentaires,
identifiés au même moment et longtemps restés volontairement non traités
(risque jugé faible en usage mono-utilisateur desktop), sont désormais
résolus :
- Concurrence entre deux appels à `activer()` — résolu par un index unique
  partiel Postgres `baux_appartement_id_actif_unique` sur
  `baux(appartement_id) WHERE statut IN ('actif', 'preavis')`, qui garantit
  la cohérence au niveau base indépendamment de tout verrou applicatif
  (`SELECT ... FOR UPDATE` jugé superflu en complément — un index unique
  B-tree sérialise déjà les écritures concurrentes). `activer()` traduit
  une violation de cet index en `ConflictException` propre plutôt que de
  laisser remonter l'erreur SQL brute (`estViolationIndexBauxActifUnique`).
- `UpdateAppartementDto` permettant de forcer `statut: 'loue'` sans bail
  réel — résolu : `AppartementsService.update()` rejette (`ConflictException`)
  toute tentative de passer un appartement à `'loue'` si aucun bail
  `actif`/`preavis` n'existe réellement pour lui, tout en préservant la
  correction légitime d'une désynchronisation existante (la vérification ne
  porte que sur l'existence du bail, jamais sur le chemin par lequel il est
  arrivé à cet état).
- Tests packages/core sur les règles de transition de statut

**Critère de complétion** : créer un bail avec deux colocataires, vérifier
que l'appartement passe automatiquement en statut loué, consulter le
dossier complet d'un locataire sur un seul écran.

---

## Module 4 — Documents
**Taille : M**

- Upload de documents avec lien polymorphe
  (sci / immeuble / appartement / locataire / bail)
- Stockage chiffré sur Scaleway Object Storage — accès exclusivement via
  route backend authentifiée, jamais d'URL publique directe
- Catégorisation selon les valeurs du data-dictionary
- Écran Documents : vue centralisée filtrable par catégorie/statut,
  recherche plein texte sur les noms de fichiers
- Glisser-déposer depuis une fiche (parcours cible de la Phase 6)
- Détection de statut expiré (`date_expiration` dépassée) — brique
  réutilisée telle quelle par le Module 6

**Critère de complétion** : glisser un document sur une fiche locataire,
le retrouver catégorisé dans l'écran Documents, vérifier qu'un document
expiré change bien de statut.

---

## Module 5 — Finances
**Taille : M**

- CRUD Paiements (rattachés à un bail), statut
  `paye / impaye / partiel`
- Écran Finances : liste filtrable par statut, regroupable par SCI ou
  échéance
- Enregistrement d'un paiement en ligne, sans changement d'écran
  (parcours cible de la Phase 6)
- Import CSV pour le rapprochement bancaire semi-automatique
- Logique de rapprochement (correspondance montant/date/référence) dans
  packages/core
- Tests packages/core sur la logique de rapprochement — priorité haute,
  erreur ici = erreur financière

**Critère de complétion** : importer un relevé CSV, voir les paiements
correspondants automatiquement rapprochés, corriger manuellement un
rapprochement incorrect.

---

## Module 6 — Moteur d'alertes
**Taille : M**

- Table `alertes` (data-dictionary)
- Job planifié quotidien côté backend, idempotent (Phase 7)
- Génération des 5 types d'alertes : `bail_fin_proche`, `document_expire`,
  `document_expire_proche`, `entretien_equipement`, `impaye`
- Écran Paramètres : seuils configurables (jours avant échéance) par type
  d'alerte
- Action "traiter une alerte" (statut → `traitee`)
- Tests packages/core sur chaque règle de génération, en particulier
  l'idempotence (le job ne doit jamais dupliquer une alerte)
- **Prérequis de conception (identifié lors du correctif "Cas B" de
  `BauxService.resilier()`, Module 5) — tranché avec l'utilisateur avant
  tout code de ce module** : ce module introduit la génération récurrente
  des échéances de loyer (une par mois, via le job planifié) — jusqu'ici,
  seule la toute première échéance était générée à l'activation d'un bail.
  Décision (voir `docs/data-dictionary.md`, section `baux`, "Décision
  produit — génération récurrente des échéances") : **aucun rattrapage
  automatique** des mois déjà écoulés avant la toute première exécution du
  job — celui-ci ne génère jamais un mois antérieur au mois courant au
  moment où il tourne, seulement le mois courant (jamais sauté, même si
  `jour_echeance` y est déjà dépassé) et les mois suivants. Raison : la
  quasi-totalité des loyers concernés (usage réel de l'application) ont
  très probablement déjà été perçus hors logiciel ; les facturer
  automatiquement créerait de fausses lignes `impaye` et de fausses
  alertes. Le rattrapage de ces mois-là reste une action manuelle et
  explicite de l'utilisateur (formulaire de paiement existant, Module 5).

**Critère de complétion** : faire tourner le job deux fois de suite sur les
mêmes données, vérifier qu'aucune alerte n'est dupliquée (vérifié par test
d'intégration Postgres réel, `apps/backend/src/alertes/alertes.integration.spec.ts`)
— la décision de non-rattrapage ci-dessus étant explicitement tranchée et
documentée, le module est considéré livré.

---

## Module 7 — Tableau de bord
**Taille : S**

- Cartes de synthèse : loyers du mois, impayés, documents
  expirés/manquants, échéances à venir
- Liste des alertes actives avec action "traiter" directement accessible
- Accès rapides : Nouveau paiement, Nouveau bail
- Finalisation du fil d'Ariane sur l'ensemble des fiches

**Critère de complétion** : ouvrir l'application et voir en un coup d'œil
s'il y a un impayé ou une échéance urgente, sans clic (parcours cible
Phase 6).

**Point laissé en suspens à l'ouverture de ce module, tranché après coup.**
Le Module 6 avait posé une vue minimale
(`apps/desktop/src/renderer/src/alertes/AlertesListView.tsx`, montée sur
`TableauDeBordPage.tsx`) — liste des alertes actives + traiter/ignorer +
un bouton "Exécuter le job maintenant" (`POST /alertes/executer-job`) —
uniquement pour satisfaire son propre critère de complétion et permettre
une vérification manuelle sans attendre le cron quotidien (1h du matin).
Ce n'était pas issu d'une conception Module 7, et la décision "garder /
déplacer / retirer" n'avait en réalité jamais été prise au moment de
construire ce module (le bouton et son commentaire "à trancher" sont
restés inchangés jusqu'à un audit de dette technique ultérieur). Tranché
depuis : le bouton est déplacé dans Paramètres
(`apps/desktop/src/renderer/src/alertes/ExecuterJobDiagnostic.tsx`),
étiqueté explicitement comme outil de diagnostic manuel — pas une action
courante de consultation du tableau de bord. La liste "Alertes actives"
avec traiter/ignorer reste sur le tableau de bord : rien dans les cartes
de synthèse du Module 7 (compteur seul, non interactif) ne la remplace.

---

## Module 8 — Palette de commandes (Ctrl+K)
**Taille : M**

- Composant de recherche universelle
- Registre d'actions (nouveau bail, nouveau paiement, etc.)
- Recherche par nom (locataires, appartements)
- Raccourci clavier global
- Vérification des parcours cibles de la Phase 6 (clics réels vs cibles
  mesurées)

**Critère de complétion** : depuis n'importe quel écran, Ctrl+K puis taper
un nom de locataire atteint sa fiche en une frappe + une touche Entrée.

**Cibles chiffrées de la Phase 6** — posées à la conception, jamais
transcrites avant ce module (retrouvées et consignées ici lors du Module 8) :

| Parcours | Cible |
| --- | --- |
| Enregistrer un paiement reçu | 3 clics + 1 raccourci clavier |
| Créer un nouveau bail (locataire existant) | 3 clics + formulaire |
| Consulter le dossier d'un locataire | 1 raccourci + 1 frappe + Entrée |
| Ajouter un document à un dossier | 2 actions |
| Voir les impayés du mois | 0 clic |

Réalisé par la palette de commandes (`apps/desktop/src/renderer/src/command-palette/`) :
- **Enregistrer un paiement reçu** : Ctrl+K → "nouveau paiement" (action) →
  recherche du bail (nom de locataire/immeuble) → sélection → atterrit sur
  Finances filtré sur ce bail (`?bailId=`) → clic "Enregistrer" → clic
  "Enregistrer" (valeurs par défaut pré-remplies). Raccourci + 2 sélections
  dans la palette + 2 clics sur l'écran Finances.
- **Créer un nouveau bail** : Ctrl+K → "nouveau bail" (action) → recherche
  d'un appartement → sélection → atterrit directement sur l'onglet "Bail
  actuel" de cet appartement, formulaire de création déjà ouvert
  (`?appartementId=...&nouveauBail=1`).
- **Consulter le dossier d'un locataire** : Ctrl+K → nom → Entrée →
  `?locataireId=...` (LocatairesPage) → fiche complète directement, sans
  passer par la liste.
- **Ajouter un document / voir les impayés** : déjà satisfaits par
  l'existant (Module 4 glisser-déposer, Module 7 carte "Impayés" du
  tableau de bord dès l'écran d'accueil) — aucun changement nécessaire côté
  Module 8, seulement vérifiés à cette occasion.

Vérifié manuellement dans Electron (SCI, immeuble, appartement, locataire,
les trois parcours ci-dessus).

---

## Dette technique

- **IPs autorisées de la base Postgres de production laissées grand ouvertes
  (0.0.0.0/0, "Allow All") — résolu, confirmé directement par le
  propriétaire.** Constaté 2026-08-12 pendant le diagnostic de connexion
  PowerSync (chantier hébergement/synchro) : l'onglet "IPs autorisées" de
  la console Scaleway pour l'instance Postgres de production ne contenait
  qu'une seule entrée, `0.0.0.0/0`, qui autorisait toute adresse IP source
  à tenter une connexion — la couche réseau n'apportait donc aucune
  restriction, la base ne dépendant que des identifiants applicatifs (mot
  de passe `powersync_role`, `appli_immo_app`, etc.) pour se protéger.
  Exposition non négligeable à l'époque : cette base contient des données
  personnelles (locataires, garants) et financières (paiements, IBAN/BIC
  chiffrés) réelles. Restreint depuis aux seules IP réellement
  nécessaires : les 5 IP PowerSync Cloud région EU (`79.125.70.43`,
  `18.200.209.88`, `18.234.18.91`, `18.233.128.219`, `34.202.251.156`,
  voir docs/integrations.md) plus l'IP personnelle actuelle du
  propriétaire pour l'administration ponctuelle (psql direct, migrations
  manuelles) — 6 IP au total, `0.0.0.0/0` n'est plus présent.

- **Chiffrement local de la base SQLite PowerSync — résolu (2026-08-14).**
  Condition posée le 2026-08-13 (voir historique de conception) avant
  d'étendre la synchronisation au-delà de `scis`, désormais levée :
  `better-sqlite3-multiple-ciphers` remplace `better-sqlite3`
  (`apps/desktop/src/main/powersync/database.worker.ts`, worker dédié —
  voir `electron.vite.config.ts`, entrée de build séparée), clé générée une
  seule fois (`crypto.randomBytes(32)`) et protégée par `safeStorage`
  d'Electron (`apps/desktop/src/main/powersync/encryption-key.ts`), jamais
  redemandée à l'utilisateur. Marqueur de migration à usage unique
  (`powersync-migration-v1-done`) distinguant le premier lancement (purge
  silencieuse d'une éventuelle base de test non chiffrée, seule fois où une
  clé est générée) du régime permanent ensuite (clé absente ou
  indéchiffrable = échec bruyant au démarrage, `dialog.showErrorBox` +
  `app.quit()`, jamais de régénération silencieuse — même principe que
  `JWT_SECRET`/`ENCRYPTION_KEY` côté backend).
  Vérifié par 3 tests réels, pas seulement "l'option est activée dans la
  config" : (1) fichier `.db` brut illisible sans la clé — en-tête sans la
  signature SQLite standard, tentative d'ouverture externe échouant avec
  `"file is not a database"` ; (2) redémarrage complet de l'app (tous
  processus tués puis relancés) — clé réutilisée depuis le trousseau
  système, horodatages de fichiers inchangés, aucune régénération ; (3)
  suppression artificielle du fichier de clé (marqueur conservé) — échec
  bruyant confirmé (aucune fenêtre créée, sortie propre, aucune
  régénération silencieuse).
  Effet de bord découvert et corrigé au passage : ajouter une seconde
  entrée de build (le worker) désactivait silencieusement
  l'externalisation d'`electron` et des dépendances réelles par
  `externalizeDepsPlugin` d'electron-vite (`electron` est en
  `devDependency`, jamais lu par ce plugin ; l'externalisation venait d'un
  préréglage interne au mode "lib" mono-entrée, contourné dès qu'on fournit
  plusieurs entrées) — `index.js` gonflait de 5,6 Ko à plus d'1 Mo et
  cassait le lancement de l'app. Corrigé en listant explicitement
  `electron` + modules Node natifs + dépendances réelles dans
  `rollupOptions.external` (`electron.vite.config.ts`).

- **Sync Stream `scis` utilisait `SELECT *` — corrigé, mais règle à
  respecter pour toute future table (priorité haute, précédent à ne pas
  reproduire).** Découvert le 2026-08-13 en inspectant directement
  `powersync.db` après le premier test réel : le schéma client PowerSync
  (`apps/desktop/src/main/powersync/schema.ts`) ne restreint que la *vue*
  exposée à l'application, jamais ce qui est physiquement stocké sur
  l'appareil. La table interne `ps_data__scis` contenait le JSON complet
  renvoyé par la requête du stream — `adresse`, `code_postal`, `ville`,
  `telephone`, `nom_gerant`, alors que le schéma client ne déclare que
  `nom`/`regime_fiscal`/`statut`. Sans gravité sur `scis` (aucune de ces
  colonnes n'est sensible), mais le mécanisme est le même quelle que soit
  la table : un `SELECT *` dans un futur stream sur `locataires`,
  `garants` ou `paiements` stockerait en clair sur l'appareil des colonnes
  jamais voulues localement, indépendamment de ce que déclare le schéma
  client.
  **Règle absolue pour la suite** : la requête de chaque Sync Stream
  (dashboard PowerSync) doit toujours lister explicitement les colonnes
  voulues, jamais `SELECT *` — même principe que la projection explicite
  déjà appliquée à `DocumentsService.versDto` (voir plus bas dans cette
  section, entrée "Retours d'API non projetés explicitement") : ne jamais laisser
  un mécanisme bas niveau décider implicitement de ce qui sort du système.
  Le stream `scis` a été corrigé dès la découverte (colonnes explicites
  `id, nom, regime_fiscal, statut`), pour servir de modèle correct au
  copié-collé lors de l'extension par domaine (docs/backlog.md, tâche
  associée), pas de mauvais exemple reproduit par habitude.
  **Distinct de la protection de `journal_audit`** (voir
  docs/data-dictionary.md, section Authentification et autorisation) :
  `journal_audit` est absente de `CREATE PUBLICATION powersync FOR TABLE
  (...)` elle-même — protection structurelle, en amont de toute requête de
  stream, qu'aucun `SELECT *` futur ne pourrait contourner puisqu'aucune
  copie de cette table n'existe côté PowerSync. La règle "colonnes
  explicites" ci-dessus ne s'applique qu'aux tables réellement présentes
  dans la publication — pour celles-ci, la vigilance de rédaction de la
  requête est le seul rempart, contrairement à `journal_audit`.

- **Mesurer le temps de synchro réel du Sync Stream `appartements` (3
  niveaux) une fois un volume de données représentatif disponible — non
  fait faute de données de test suffisantes lors du déploiement initial.**
  Constaté le 2026-08-15 lors du déploiement des Sync Streams `immeubles`
  et `appartements` (sous-requête imbriquée à 3 niveaux : `appartements` →
  `immeubles` → `organisation_sci` → `utilisateurs`, jamais testée à cette
  profondeur auparavant, contre 2 niveaux pour `scis`). Tests 1 et 2
  (données remontées localement, absence d'`identifiant_fiscal`) validés
  avec preuve concrète. Test 3 (temps de réponse) volontairement non fait :
  avec seulement 1 ligne par table (données de seed), `ps_stream_subscriptions`
  et `ps_sync_state` montrent un `last_synced_at` identique pour `scis`,
  `immeubles` et `appartements` — PowerSync synchronise les streams
  souscrits en un seul cycle combiné, sans jalon mesurable par flux à ce
  volume, donc aucune mesure obtenue à ce stade n'aurait été représentative
  d'un vrai coût de requête à 3 niveaux. À refaire quand un volume réel sera
  disponible (ex. migration des ~20 biens réels).
  **Contexte ajouté (2026-08-21)** : la mesure elle-même n'a toujours pas
  été faite — mais des streams bien plus profonds que 3 niveaux ont depuis
  été déployés et testés sans problème observé (`diagnostics` à 6 niveaux,
  `alertes`/`document_expire` jusqu'à 7 niveaux d'imbrication). Ça ne
  remplace pas une vraie mesure sur volume réel, mais l'inquiétude
  initiale sur la profondeur de requête ne s'est pas concrétisée en
  pratique jusqu'ici.

- **Trop-perçu non traité à la résiliation d'un bail réglé en cours de mois
  — résolu (commit `4868648`).** Identifié Module 5, lors de la conception
  de la proration des échéances ; complété après revue par
  financial-logic-reviewer sur ce même chantier. `BauxService.resilier()`
  proratise l'échéance de loyer du mois de `date_fin` uniquement si elle
  est encore `impaye`/`partiel` (`docs/data-dictionary.md`, section baux).
  Deux chemins menaient au même trop-perçu non traité, ni calculé, ni
  signalé, ni remboursé :
  1. L'échéance est déjà réglée intégralement (`statut=paye`) au moment de
     la résiliation : le système ne la touche pas du tout.
  2. L'échéance est `partiel` mais le montant déjà versé (`montant_paye`)
     dépasse le nouveau montant proratisé (plus petit que le montant
     mensuel plein) : le recalcul du statut (`calculerStatutPaiement`) la
     fait alors basculer à `paye`, ce qui est correct en soi (tout ce qui
     est dû est réglé), mais laissait le même trop-perçu résiduel non
     traité que le cas 1.
  Résolu par le chantier "versements & remboursements" (table
  `remboursements`, type `trop_percu`) : `BauxService.resilier()` calcule
  et expose `tropPercu` (les deux chemins ci-dessus, via la même
  comparaison `montantRecu`/`montantProratise` — jamais écrit en base,
  décision D3), `TableauDeBordService.getRemboursementsEnAttente()`
  recalcule la même chose à la volée pour rester visible tant qu'aucun
  remboursement ne le couvre, et `RemboursementsSection`
  (`apps/desktop/src/renderer/src/patrimoine/BailTabs.tsx`) affiche le
  bandeau "Trop-perçu signalé" avec bouton "Créer le remboursement" sur
  tout bail résilié concerné — même pattern que le remboursement du dépôt
  de garantie, toujours un acte humain explicite via
  `RemboursementsService.create()`, jamais d'automatisation silencieuse.
  Confirmé visuellement dans Electron le 2026-08-24.

- **Remboursement du dépôt de garantie — modélisé sommairement, motif de
  retenue toujours insuffisant — résolu (2026-08-24).** Le chantier
  "versements & remboursements" avait modélisé le remboursement lui-même
  (table `remboursements`, type `depot_garantie`), avec un simple champ
  `commentaire` texte libre pour justifier un écart entre montant reçu et
  montant remboursé — jugé insuffisant (pas de catégorie exploitable pour
  des statistiques ou un futur contentieux, pas de pièce jointe possible).
  L'utilisateur avait redemandé ce point explicitement le 2026-07-30.
  Résolu par l'ajout d'un motif structuré (`remboursements.motif_retenue`,
  enum `degradation_locative` \| `reparations_locatives_non_effectuees`
  \| `charges_impayees` \| `loyers_impayes` \| `autre`, catégories issues
  de la pratique/jurisprudence — la loi n° 89-462 art. 22 impose une
  justification mais aucune nomenclature) et d'une pièce jointe chiffrée
  (4 colonnes dédiées sur `remboursements`, pas une 7e cible sur le lien
  polymorphe `documents` — relation 1:1 stricte, aucun cycle de vie à
  gérer, voir `docs/data-dictionary.md`, section "Motif de retenue dépôt de
  garantie"). Les deux sont exigés ensemble uniquement pour une retenue
  réelle (`type=depot_garantie` ET `montant_rembourse < montant_origine`),
  validé dans `RemboursementsService.create()`, rejet strict sinon.

- **Aucune validation que `date_fin` ≥ `date_debut` à la résiliation —
  corrigé.** (Identifié par financial-logic-reviewer lors du correctif
  "Cas B" de `BauxService.resilier()`, gap préexistant dans le code
  d'origine du Module 5 — pas introduit par ce correctif.)
  `ResilierBailDto` ne validait que le format de `dateFin`
  (`@IsDateString()`), jamais son ordre chronologique par rapport au début
  réel d'occupation du bail. `resilier()` rejette désormais explicitement
  (`ConflictException`) toute `dateFin` antérieure à `bail.dateDebut`,
  avant tout effet de bord, comparé contre `date_debut` (le vrai début
  d'occupation) et non `date_activation` (purement administrative — voir
  `docs/data-dictionary.md`, section baux).
  **Bug distinct découvert au passage par cette même revue, corrigé dans le
  même correctif** : le "Cas A" de `resilier()` (une échéance couvre déjà
  le mois de résiliation) reproratisait `echeanceDuMois.montant` tel quel
  plutôt que de le recalculer depuis `loyer_mensuel`/`provisions_charges`.
  Si cette échéance était l'échéance d'**entrée** (déjà proratisée depuis
  `date_debut`) et que la résiliation tombait dans le **même mois
  calendaire** que `date_debut`, le montant était reproratisé une seconde
  fois — double-décote silencieuse (~238,80 € facturés au lieu de ~29,03 €
  dans le scénario testé : bail de 900 €/mois entré et résilié le même
  jour). Corrigé en unifiant le calcul (une seule formule, avant la
  branche Cas A/Cas B, avec `date_debut` systématiquement passé en repère
  d'occupation à `calculerProrataOccupationPartielle`) plutôt qu'en
  gardant deux formules indépendantes susceptibles de diverger à nouveau —
  voir `docs/data-dictionary.md`, section baux, pour le détail de
  l'exception "même mois calendaire". Testé
  (`locataires-baux.integration.spec.ts`) : rejet explicite avec vérification
  qu'aucun état n'est modifié, cas limite `dateFin === dateDebut` avec
  montant exact vérifié, non-régression des 3 scénarios de prorata
  préexistants.

- **Versioning des documents (historique des versions) — résolu.** Prévu au
  cahier des charges initial, jamais retranscrit dans le backlog détaillé du
  Module 4 lors de la Phase 10 (écart de transcription, pas une décision de
  scope délibérée), confirmé hors périmètre du Module 4 MVP tel que
  construit à l'époque. Implémenté depuis : `document_precedent_id`
  (auto-référence nullable vers `documents.id`) chaîne un nouvel upload à la
  version qu'il remplace ; `DocumentsService.remplacerDocument()` crée la
  nouvelle ligne puis archive l'ancienne (même mécanisme que `archiver()`)
  dans la même transaction — jamais de suppression physique, jamais deux
  versions `valide` simultanées dans une même chaîne. Endpoint dédié `POST
  /documents/:id/remplacer`. Seule la version courante (non archivée) peut
  être remplacée ; un upload sans lien de version reste toujours possible
  via `DocumentsService.upload()`, y compris pour une entité ayant déjà un
  document archivé manuellement. Voir docs/data-dictionary.md, section
  documents, pour le détail. Affichage d'un historique de versions côté
  desktop : hors périmètre, sujet UX futur.

- **Tableau de bord — dépenses réelles, rentabilité nette et comparaison
  provisions/charges réelles impossibles** tant qu'aucun module de suivi
  des charges/travaux n'existe (Modules 6/9 du cahier des charges initial,
  jamais construits en MVP). Le Module 7 affiche donc un revenu **brut**
  (aucune dépense déduite) et des "provisions collectées" sans comparaison
  aux charges réelles, explicitement étiquetés comme tels pour ne pas
  laisser croire à une rentabilité nette ou une régularisation qui
  n'existent pas. À réévaluer une fois le futur module "Suivi des charges
  et fiscalité" construit (voir section "Modules futurs" ci-dessous).

- **Paiement réglé en plusieurs versements — non représentable tel quel —
  corrigé** (identifié lors de la conception du graphique "Revenus
  locatifs", Module 7 ; limite préexistante du modèle `paiements`, pas
  introduite par ce module ; résolu par le chantier "versements &
  remboursements", `docs/data-dictionary.md"). Une ligne `paiements` ne
  portait qu'un seul couple (`montant_paye`, `date_paiement`) — chaque
  appel à `PaiementsService.enregistrer()` (méthode supprimée depuis)
  écrasait la valeur précédente plutôt que de l'additionner. Un règlement
  en deux versements sur des dates différentes (ex. 400 € le 5, puis
  400 € le 20 pour une échéance de 800 €) ne conservait que le dernier
  appel : tout graphique basé sur la date attribuait alors la totalité à
  la dernière date, pas à la répartition réelle dans le temps. Résolu par
  la table `versements` (un paiement peut désormais avoir plusieurs
  lignes de règlement, chacune attribuée au mois de sa propre date) — les
  colonnes legacy `montant_paye`/`mode`/`date_paiement`/
  `reference_rapprochement` ont été retirées de `paiements` à la Phase 3
  (contract) de ce chantier.

- **Checklist documentaire — backend résolu (2026-08-24), pendant desktop
  restant.** Prévue au cahier des charges initial ("checklist
  documentaire", "indicateur visuel documents manquants"), jamais
  implémentée jusqu'ici : identifié en concevant la carte "Documents
  expirés" du Module 7, qui n'affichait donc que les documents expirés
  (statut déjà calculé), jamais "manquants". Portée simple retenue (pas
  de distinction obligatoire/recommandé) : DPE/élec-gaz/CREP/ERP par
  appartement, pièce d'identité par locataire actif et par garant actif —
  voir `docs/data-dictionary.md`, section "Checklist documentaire", pour
  le détail (règle de complétude, calcul à la volée, et le blocage
  découvert en cours de route : ajout de `garant` comme 7e cible du lien
  polymorphe `documents.entite_type`, absent jusque-là). Reste à faire :
  la carte sur le Tableau de bord desktop, et un moyen d'attacher un
  document à un garant depuis l'UI (inexistant aujourd'hui, contrairement
  à locataire/appartement).

- **Retours d'API non projetés explicitement — 13 services, motif pas
  occurrence isolée.** Découvert en corrigeant `DocumentsService.versDto`
  (2026-08-10, `chemin_stockage` — une clé de stockage interne — fuyait
  vers le frontend via un `...document` brut). Grep systématique sur
  `apps/backend/src/**/*.service.ts` : 13 autres services renvoient une
  ligne Drizzle (`.select()`/`.returning()`) directement ou via spread, à
  l'API, sans liste blanche de champs. Aucune de leurs tables ne porte de
  colonne sensible aujourd'hui (vérifié contre `packages/db/src/schema` au
  moment de cette entrée) — mais rien n'empêche un futur ajout de colonne
  sensible sur l'une d'elles de fuiter en silence, exactement comme
  `chemin_stockage`. Les deux endroits qui manipulent une vraie donnée
  sensible (`comptes_bancaires_sci.iban_chiffre`/`bic_chiffre`,
  `utilisateurs.mot_de_passe_hash` via `AuthService`) utilisent déjà une
  projection explicite — c'est le reste du CRUD "ordinaire" qui ne le fait
  pas. Fichiers concernés (à traiter au fil de l'eau, pas en un seul
  chantier — chacun mérite sa propre revue des champs à exposer) :
  1. `apps/backend/src/etats-des-lieux/etats-des-lieux.service.ts`
  2. `apps/backend/src/appartements/appartements.service.ts`
  3. `apps/backend/src/scis/scis.service.ts`
  4. `apps/backend/src/immeubles/immeubles.service.ts`
  5. `apps/backend/src/baux/baux.service.ts`
  6. `apps/backend/src/garants/garants.service.ts`
  7. `apps/backend/src/remboursements/remboursements.service.ts`
  8. `apps/backend/src/paiements/paiements.service.ts`
  9. `apps/backend/src/versements/versements.service.ts`
  10. `apps/backend/src/alertes/alertes-config.service.ts`
  11. `apps/backend/src/equipements/equipements.service.ts`
  12. `apps/backend/src/bail-locataires/bail-locataires.service.ts`
  13. `apps/backend/src/locataires/locataires.service.ts`

  Cas apparenté, à surveiller séparément : `apps/backend/src/users/
  users.service.ts` (`findByEmail`/`findById`) renvoie aussi la ligne
  brute — donc `mot_de_passe_hash` — mais reste sans risque aujourd'hui
  car aucun `UsersController` n'existe et ses deux seuls appelants
  (`AuthService.validateUser`, `ScisService`) re-projettent avant de
  renvoyer quoi que ce soit plus loin. Le jour où un endpoint utilisateur
  est exposé directement, vérifier qu'il ne réutilise pas ces méthodes
  telles quelles.

- **Bug de backfill initial PowerSync — résolu par contournement
  (2026-08-20).** Découvert sur le Sync Stream `indices_irl` : la donnée
  vide en base (job planifié jamais déclenché en production, task #159
  toujours pending) a d'abord été corrigée (`POST
  /indices-irl/executer-job` déclenché manuellement contre Scaleway,
  1 ligne réelle 2026/T2/148.37 créée) — mais le Sync Stream est resté
  bloqué à `total:0/downloaded:0` malgré tout confirmé par ailleurs :
  table dans la publication Postgres, REPLICA IDENTITY identique aux
  tables fonctionnelles, souscription active côté client, redéploiement
  avec nouveau hash de définition (sans effet — le bucket
  `elements_inventaire_meuble` s'est régénéré normalement au même
  redéploiement, `indices_irl` jamais initialisé), dashboard PowerSync
  "All clear".
  Cause identifiée par élimination : le **backfill initial** du snapshot
  logique Postgres n'a pas capté cette ligne, née *avant* le déploiement
  du stream — problème connu de la réplication logique Postgres/PowerSync
  dans certaines conditions (ordre entre création de la publication et
  écriture de la donnée, ou redémarrage du slot de réplication
  entretemps). Vérifié par un test décisif : une ligne insérée *après*
  coup (`annee=9999, trimestre=9`, marqueur de test) s'est répliquée
  normalement (`total:1/downloaded:1`) alors que la ligne préexistante
  restait invisible — la réplication continue fonctionne, seul le
  backfill initial est en cause.
  **Contournement appliqué** : suppression ciblée par `id` de la ligne
  réelle jamais captée (`apps/backend/scripts/
  delete-indices-irl-backfill-manquant.ts`, script jetable, DELETE
  explicite sur deux lignes précises — jamais un DELETE générique sur la
  table), puis re-déclenchement de `POST /indices-irl/executer-job` pour
  la recapter comme une écriture neuve (nouvel `id`, `date_recuperation`
  reflétant la vraie date de cette nouvelle captation). `indices_irl` est
  la seule table de ce chantier où un `DELETE` a été jugé acceptable :
  aucune contrainte référentielle ne pointe vers `indices_irl.id`
  (vérifié), et la table n'a de toute façon pas de mécanisme d'archivage
  standard (`statut`/`archived_at`) par design.
  **À surveiller pour tout futur Sync Stream déployé avant que sa
  première donnée n'existe** : si une table reste bloquée à
  `total:0/downloaded:0` malgré souscription active et donnée source
  confirmée, tester d'abord si une écriture *nouvelle* se réplique
  (signe de backfill cassé plutôt qu'un problème de réplication
  générale) avant de chercher ailleurs.
  **Incident en cours de route (2026-08-20)** : la ligne réelle
  2026/T2/148.37 a disparu une seconde fois, de façon inattendue, avant
  même d'être supprimée volontairement par le contournement ci-dessus
  (`delete-indices-irl-backfill-manquant.ts` a constaté son absence au
  lieu de la supprimer lui-même). Cause non confirmée avec certitude.
  Hypothèse la plus probable, non prouvée : `bail-document-docx
  .integration.spec.ts` exécute un `DELETE FROM indices_irl` sans
  condition dans deux tests (protégé en théorie par une transaction
  annulée en `afterEach`) — si ce fichier avait tourné à un moment donné
  avec `DATABASE_URL` pointant Scaleway et que le `ROLLBACK` n'avait pas
  abouti (process interrompu avant la fin), la suppression serait restée
  définitive. Pistes explorées et écartées faute de preuve : ni un
  `pnpm test`/`pnpm --filter backend test` lancé manuellement par le
  propriétaire ou par l'agent durant ce chantier, ni un hook Git
  (aucun hook actif dans `.git/hooks/`, uniquement des `.sample`), ni le
  workflow GitHub Actions (`DATABASE_URL` codé en dur vers le Postgres
  éphémère du runner, aucun accès réseau ni secret vers Scaleway). Aucune
  trace dans `journal_audit` (table non instrumentée pour ce type
  d'événement — l'enum `journal_audit_action` n'a même pas de valeur
  "suppression"). **Garde-fou ajouté en prévention** (pas en réponse
  prouvée à cet incident) :
  `apps/backend/src/test-utils/transactional-test.ts`,
  `createTransactionalTestHooks` refuse désormais de démarrer si
  `DATABASE_URL` contient l'IP Postgres de production Scaleway
  (`212.47.241.9`) — protège les 13 fichiers de test d'intégration qui
  utilisent ce helper, pas seulement `bail-document-docx`.
  **Suivi (2026-08-21)** : aucune récidive observée sur le reste du
  chantier PowerSync depuis cet incident — les domaines Documents, État
  des lieux et Alertes se sont tous déployés et testés sans problème
  similaire jusqu'à la clôture complète du chantier.

- **`locataires.anonymise_le` documenté** (`docs/data-dictionary.md` ligne
  85, commentaire du schéma Drizzle) **comme mécanisme d'anonymisation
  RGPD mais jamais implémenté côté code** — aucun endpoint, job planifié,
  ou logique de neutralisation ne pose ou n'exploite ce champ. Découvert
  lors de la conception du Sync Stream `locataires`. À trancher : soit
  implémenter réellement le mécanisme, soit retirer la mention de la
  documentation si ce n'est plus prévu.

- **Sync Stream `documents` incomplet sur la branche `etat_des_lieux` —
  résolu (2026-08-21).** `documents.entite_id` est une référence
  polymorphe sur 6 cibles (`sci`, `immeuble`, `appartement`, `locataire`,
  `bail`, `etat_des_lieux`). Le Sync Stream `documents` (et
  `diagnostics`, filtré par `document_id IN (documents)`) n'a couvert que
  les 5 branches connues entre le 2026-08-20 et le 2026-08-21 —
  `etat_des_lieux` était exclue, le domaine État des lieux n'ayant pas
  encore de Sync Stream lui-même. La 6e branche (filtrage vers
  `etats_des_lieux`, même chaîne que `baux`) a été ajoutée aux deux
  requêtes dans `docs/powersync-sync-streams.yaml`.

- **Chantier PowerSync — extension par domaine : terminé (2026-08-21).**
  Les 8 domaines prévus ont tous été traités et déployés, domaine par
  domaine : Patrimoine (scis/immeubles/appartements/equipements),
  Locataires & baux (baux/garants/bail_locataires/locataires), Finances
  (paiements/versements/remboursements), Alertes
  (parametres_alertes puis alertes elle-même, terminée en dernier),
  Références globales (indices_irl/elements_inventaire_meuble), Documents
  (documents/diagnostics), État des lieux (12 tables). Une seule
  exclusion volontaire et permanente : `comptes_bancaires_sci`, jamais de
  Sync Stream (IBAN/BIC chiffrés, consultation exclusivement via
  l'endpoint authentifié dédié, voir plus bas). **29 Sync Streams au
  total** — `docs/powersync-sync-streams.yaml` fait foi comme source de
  vérité versionnée de ce qui est réellement déployé dans le dashboard
  PowerSync, pas ce fichier.

---

## Maintenance

- **Clé API Object Storage (application `appli-immo-backend`) — expire le
  2027-08-08.** À renouveler avant cette date : en cas d'expiration non
  anticipée, le stockage des documents (pièces d'identité, RIB, photos
  d'état des lieux) tombe en panne.

---

## Hors backlog MVP (rappel, voir docs/app-spec.md section 5)

Charges, Révision INSEE, Travaux, IA, envoi automatique d'emails,
connexion bancaire automatique — feront l'objet de backlogs dédiés au
moment de leur développement, une fois le MVP livré.

---

## Modules futurs (post-MVP)

**Ordre de priorité confirmé par l'utilisateur** (décision prise hors
session Claude Code, consignée ici a posteriori) :
1. Édition d'un bail (génération du document légal lui-même)
2. État des lieux
3. Charges et fiscalité (détaillé ci-dessous)
4. Intervention (détaillé ci-dessous)

### Édition d'un bail (en cours, priorité 1)

État des lieux du schéma réalisé (audit + recherche des modèles-types
officiels, vérifiés directement sur le texte de l'annexe du décret
n° 2015-587 — pas une synthèse générale) avant tout code. Sources :
décret n° 2015-587 du 29 mai 2015 (contrats types vide/meublé, annexes 1
et 2) et décret n° 2015-981 du 31 juillet 2015 (liste des 11 éléments de
mobilier obligatoires en location meublée).

**Principe directeur retenu** : les nouveaux champs identifiés ci-dessous
sont **nullables**, renseignables progressivement (même convention que
`jour_echeance`/`surface`/`loyer_reference` déjà en base) — **jamais
obligatoires à la création** de l'entité. C'est la **génération du bail
elle-même** qui doit refuser explicitement de produire le document si un
champ requis manque (message clair du type "Renseignez l'année de
construction de l'immeuble avant de générer ce bail"), jamais une valeur
par défaut inventée ni un champ vide laissé silencieusement dans un vrai
document légal généré.

**Schéma — déjà en base, vérifié directement dans les fichiers Drizzle
(2026-08-21) : le paragraphe précédent listant ces champs comme "à
ajouter" était périmé, corrigé.** Tous les champs suivants existent déjà :
`organisations.adresse/code_postal/ville`, `scis.adresse/code_postal/
ville/nom_gerant/prenom_gerant` (+ colonnes bonus non prévues initialement
ici : `scis.telephone`, `scis.forme_juridique`, `scis.siret`,
`scis.est_familiale`), `immeubles.type_habitat/regime_juridique/
annee_construction`, `appartements.identifiant_fiscal/
nombre_pieces_principales/mode_chauffage/mode_eau_chaude`,
`baux.travaux_realises`, `garants.adresse/code_postal/ville/profession/
revenus`. Cohérent avec le fait que `BailDocumentDocxService` (voir plus
bas) consomme déjà ces colonnes pour générer un document réel.

Table `diagnostics`, en 1:1 avec `documents` (FK `document_id`,
  réutilise le lien polymorphe déjà existant de `documents` plutôt que
  d'en recréer un) : `type` (`dpe` | `crep_plomb` | `erp`) + champs
  optionnels selon le type — `classe_dpe` (enum A-G) et
  `depenses_theoriques_chauffage` (le DPE porte les deux) pour `dpe` ;
  `risque_present` (boolean) pour `crep_plomb`/`erp`. Rattachement déjà
  possible au bon niveau : `documents.entite_type` supporte déjà
  `"immeuble"` (ERP, souvent tout le bâtiment) et `"appartement"` (DPE,
  CREP, élec/gaz, par lot) — vérifié dans le schéma existant, aucun
  changement nécessaire sur `documents` pour ça. **Pas de ligne
  `diagnostics` pour l'élec/gaz** : vérifié sur le texte exact du
  contrat-type, le DPE cite une valeur de résultat en toutes lettres
  ("niveau de performance du logement : [classe...]") alors que l'élec/gaz
  ne fait que renvoyer à l'annexe sans citer de résultat — `documents.
  date_expiration` (déjà existant) suffit pour cette seule mention.

  **Écart réel découvert à l'implémentation de la section XI (annexes) du
  document généré** : `documents.categorie` ne porte aucune valeur dédiée à
  l'élec/gaz — seulement `diagnostic` (générique) et `dpe` (spécifique). Un
  document `categorie=diagnostic` sans ligne `diagnostics` associée est
  aujourd'hui indiscernable entre "c'est l'élec/gaz" et "c'est un autre
  diagnostic générique pas encore structuré". `BailDocumentService` ne
  peut donc pas détecter la présence réelle de ce diagnostic — la section
  XI l'affiche toujours "absent" par défaut (voir le commentaire dans
  `apps/backend/src/bail-document/bail-document.service.ts`). Deux
  solutions possibles, à trancher au moment de construire l'UI de saisie
  des diagnostics, pas maintenant : (a) une valeur d'enum dédiée sur
  `documents.categorie` (ex. `elec_gaz`), ou (b) élargir `diagnostics.type`
  (actuellement `dpe` \| `crep_plomb` \| `erp`) avec une quatrième valeur,
  même sans champ de résultat associé — juste pour permettre la
  détection de présence.

Décisions actées à l'époque sur les champs restants, toujours valables :
- `garants` : adresse, code_postal, ville, profession, revenus — tous
  confirmés mentions obligatoires de l'acte de cautionnement sous peine de
  nullité absolue (loi ALUR), pas seulement l'adresse initialement
  demandée. Sans risque à ajouter directement sur `garants` : contrairement
  à `locataires`, cette table est déjà une ligne par bail (pas une entité
  partagée), ces champs sont donc naturellement figés au moment de la
  création du cautionnement, jamais à faire évoluer après coup.
- **`locataires` : rien à ajouter.** Vérifié sur le texte exact du
  contrat-type (préambule d'identification des parties) : ni date ni lieu
  de naissance ne sont exigés, contrairement à une première affirmation
  erronée de ma part avant vérification — seulement nom/prénom (+ email
  facultatif).
- **Loyer du précédent locataire (mention obligatoire si départ < 18
  mois) : aucun champ à ajouter.** Calculable à la génération depuis
  l'historique des baux déjà en base (loyer du bail précédent sur le même
  appartement + sa `date_resiliation`).
- **Destination des locaux (habitation seule/mixte) : non retenue.**
  Non retrouvée explicitement dans le texte vérifié, et l'app ne gère que
  du locatif résidentiel pur — à revoir seulement si un usage mixte
  devient un besoin réel.
- **"Autres parties du logement" et "éléments d'équipements" (mentions à
  vocabulaire non fermé, seulement des exemples dans le texte officiel) :
  non modélisées** — texte libre saisi une fois par bail au moment de la
  génération, aucune réutilisation ailleurs dans l'app ne le justifie.

**Inventaire de mobilier (bail meublé, liste légale fermée de 11 postes,
décret n° 2015-981) : différé au module État des lieux** (priorité 2,
ci-dessous) plutôt que modélisé ici — décision explicite de l'utilisateur.
Pour ce module-ci, le bail meublé se contente de mentionner "un inventaire
de mobilier est annexé au présent bail" sans le détailler lui-même ; le
document réel (et sa structure de données) viendra du futur module État
des lieux, rattaché comme document lié au bail (Module 4, `documents`).
Voir l'entrée "État des lieux" ci-dessous pour le lien explicite entre les
deux.

**Deux parties distinctes du document généré, découvertes après coup en
comparant à un vrai bail concurrent (Rentila, fourni par l'utilisateur
comme repère — jamais copié tel quel, uniquement utilisé pour savoir quoi
vérifier sur les sources officielles)** :
1. **"Conditions particulières"** — sections I à XI déjà codées et
   vérifiées contre le décret n° 2015-587 (voir ci-dessus).
2. **"Conditions générales"** — texte plus long, en grande partie
   standardisé, qui **ne vient pas du décret 2015-587** contrairement à
   une hypothèse initiale : vérifié directement sur la version en vigueur
   de l'annexe 1 ("Ce modèle-type ne fournit que des cadres... Les
   dispositions d'ordre public applicables figurent dans la notice
   d'information annexée... non reproduites ici"). Deux sources
   distinctes, **statuts différents** :
   - **Notice d'information** (arrêté du 29 mai 2015, modifié 2023) :
     document **fixe**, identique pour tous les baux (6 rubriques :
     établissement du bail, droits/obligations, fin de contrat, départ
     conjoint victime de violences, règlement des litiges, contacts
     utiles) — **à joindre tel quel** (fichier statique stocké une fois
     pour toutes), **jamais généré** par bail, aucun champ variable.
   - **Loi n° 89-462 du 6 juillet 1989** elle-même (articles 3 à 24
     environ) : substance juridique **à générer** depuis les données du
     bail — obligations bailleur (art. 6) / locataire (art. 7), révision
     du loyer (art. 17-1, formule IRL), charges/régularisation (art. 23),
     dépôt de garantie (art. 22, vérifié stable depuis 2014 : plafond 1
     mois, restitution 1 ou 2 mois selon conformité état des lieux,
     majoration retard 10 %/mois), résiliation locataire (art. 15, préavis
     3 mois / 1 mois dans 5 cas exhaustifs) et bailleur (art. 15, préavis 6
     mois, motifs limitatifs), état des lieux contradictoire (art. 3-2).
     **Pas encore implémenté** (uniquement sections VII et VIII mises à
     jour pour l'instant, voir ci-dessous) — reste à faire section par
     section, une fois le reste validé.
   - **Clause pénale — jamais de section dédiée, confirmé avec
     l'utilisateur.** Art. 4 i) de la loi 1989 interdit purement et
     simplement toute pénalité/amende contractuelle, sans exception :
     une section "Clause pénale" serait vide par construction. Fusionnée
     dans la seule section "Clause résolutoire" (VIII), jamais nommée
     séparément, pour ne pas laisser croire qu'une pénalité financière
     existerait légalement.
   - **Tolérances, élection de domicile** : aucun fondement légal
     spécifique trouvé — entièrement rédactionnel, pas une exigence de la
     loi 1989.

**Clause résolutoire (section VIII) — logique conditionnelle sur la date,
implémentée** (`packages/core`, `calculerClauseResolutoire`) : découverte
d'un décret n° 2026-596 du 6 juillet 2026 (JO), modifiant le décret
2015-587, **applicable aux contrats conclus ou renouvelés à compter du 1er
octobre 2026** (article 3 du décret, vérifié texte exact) — jamais codé
comme "un seul régime pour l'instant", les deux existent en parallèle
selon la date :
- **Avant le 1er octobre 2026** : clause facultative, délai d'un mois,
  4 motifs regroupés (loyer/charges/dépôt de garantie/assurance) — texte
  déjà vérifié et inchangé.
- **À partir du 1er octobre 2026** : clause **obligatoire** pour
  loyer/charges/dépôt de garantie, délai réduit à **six semaines** ;
  assurance et troubles de voisinage traités séparément (délai d'un mois,
  motifs facultatifs) ; motif supplémentaire si le logement est soumis à
  une "servitude de résidence principale" (nouvelle mention, article L.
  151-14-1 du code de l'urbanisme).
- **Limite assumée** : la loi parle de contrats "conclus" à telle date ;
  notre schéma n'a pas de date de signature distincte de `baux.date_debut`
  — utilisée comme approximation, la plus proche disponible, pas une
  certitude absolue.
- **Servitude de résidence principale** : aucun champ en base pour
  savoir si un logement y est soumis (désignation d'urbanisme rare,
  propre à certaines communes) — paramètre de génération explicite
  (`servitudeResidencePrincipale` du DTO), jamais déduit silencieusement,
  uniquement à partir du 1er octobre 2026. À modéliser en base si le
  besoin se confirme.
  - **Section II.B (DESTINATION EXCLUSIVE DES LOCAUX)** : nouvelle
    mention — présente depuis l'implémentation initiale de ce module.
  - **Section VIII (motif de résiliation supplémentaire) — trou réel,
    corrigé le 2026-08-24.** Cette section affirmait déjà cette double
    présence, mais seule II.B était réellement câblée dans le vrai
    template (`{#clauseResolutoireApres}` n'avait jamais reçu le motif
    correspondant) — écart constaté en vérifiant le code, pas supposé.
    Fondement légal vérifié Légifrance (deux fetches indépendants
    concordants) : le décret n° 2026-596 lui-même modifie l'annexe 1 du
    décret 2015-587 pour ajouter ce motif à la clause résolutoire, avec
    un délai de mise en demeure propre fixé par le maire — art. L. 481-4,
    II du code de l'urbanisme (jamais les six semaines/un mois des autres
    motifs). Texte inséré verbatim, gardé par le flag `servitude`
    existant (aucun nouveau flag). `construireTexteClauseResolutoire`
    (packages/core, jusqu'ici orpheline et non appelée) mise à jour avec
    la même formulation verbatim + référence L. 481-4, mais reste non
    appelée par le service — le texte réellement généré vient du
    `.docx`, pas de cette fonction (même écart que documenté ailleurs
    dans ce fichier pour le reste de son texte).

**Section VII (solidarité/indivisibilité) — complétée** : règle
d'extinction de la solidarité à 6 mois après le congé (article 8-1 de la
loi 1989) ajoutée, mais **uniquement affichée en cas de colocation
effective** (plusieurs `bail_locataires` actifs sur le bail) — jamais sur
un bail à un seul locataire, cette règle ne concernant que la colocation à
bail unique.

**Indice IRL (révision du loyer, art. 17-1) — infrastructure construite et
en service.** Point d'accès officiel confirmé par test direct (pas
supposé) : `GET https://api.insee.fr/series/BDM/V1/data/SERIES_BDM/001515333`
(série BDM 001515333 = "Indice de référence des loyers (IRL)"), réponse
XML SDMX-ML, aucune authentification requise en pratique — à surveiller si
INSEE ferme un jour cet ancien endpoint au profit du nouveau portail à clé
(`portail-api.insee.fr`, décrit comme accès restreint pour la version
actuelle du catalogue). Paramètre `lastNObservations=1` utilisé pour ne
récupérer que la dernière valeur trimestrielle.

Architecture livrée (`apps/backend/src/indices-irl/`) :
- Table `indices_irl` (annee, trimestre, valeur, date_recuperation),
  contrainte d'unicité (annee, trimestre) — pas de colonnes d'audit
  standard, même principe que `journal_audit` (référence, jamais modifiée
  après coup).
- `IndicesIrlService.synchroniser()` : appelle l'INSEE, insère la nouvelle
  observation si elle n'est pas déjà connue (idempotent via
  `onConflictDoNothing`) — jamais d'appel à chaque génération de bail.
- `IndicesIrlJobService` (`@Cron(CronExpression.EVERY_DAY_AT_3AM)`) :
  vérification quotidienne (coût réel nul, un seul appel HTTP léger),
  chaque échec explicitement journalisé (`Logger.error`) — jamais un
  silence qui ne se remarque qu'au blocage 4 mois plus tard. Déclenchement
  manuel disponible (`POST /indices-irl/executer-job`, même principe que
  le job d'alertes du Module 6).
- `packages/core`, `irlEstPerime(dateRecuperation, dateReference)` :
  règle pure, testée — plus de 4 mois d'écart (l'IRL étant trimestriel, un
  tel écart signale un problème de rafraîchissement, pas une absence
  légitime de nouvelle publication).
- `BailDocumentDocxService` lit uniquement la dernière valeur déjà
  stockée ; absente ou périmée, `irlIndisponible` rejoint la liste des
  champs manquants de `validerCompletudeGenerationBail` — la génération
  bloque avec un message clair, **plus aucun marqueur "non disponible"
  inséré dans le document** (l'exception temporaire posée en urgence
  avant que cette infrastructure existe est levée).

Cette infrastructure (table + job + endpoint) est directement réutilisable
par le futur module "Révision annuelle" du cahier des charges initial
(`docs/app-spec.md`) — pas seulement pour l'édition du bail.

**Ce qui reste réellement à faire sur ce module (état vérifié le
2026-08-21)** :
- Substance de la loi n° 89-462 (articles 3 à 24 environ) au-delà des
  sections VII (solidarité/indivisibilité) et VIII (clause résolutoire),
  déjà codées et vérifiées — le reste (obligations bailleur/locataire,
  révision du loyer, charges/régularisation, dépôt de garantie,
  résiliation, état des lieux contradictoire) reste à générer section par
  section.
- **Structuration élec/gaz et détection des diagnostics en pièce annexée
  — tranchée et implémentée (2026-08-23).** Décision : valeurs dédiées
  sur `documents.categorie` (`elec_gaz`, `crep_plomb`, `erp` — `dpe`
  existait déjà), pas d'élargissement de `diagnostics.type` — cette
  dernière table reste réservée aux diagnostics à résultat structuré cité
  dans le corps du bail (aucun à ce jour) et n'est encore reliée à aucun
  module/UI (schéma seul, migration 0027). `BailDocumentDocxService`
  détecte la présence de chacun des 4 diagnostics (`documents.categorie`,
  non archivé, rattaché à l'appartement OU à l'immeuble du bail — rien
  n'impose l'un ou l'autre) et affiche la ligne correspondante en section
  PIECES ANNEXEES (formulation reprise du décret n° 2015-587, annexe 1,
  section XI.B). Formulaire d'upload et filtre Documents (desktop) mis à
  jour avec les 3 nouvelles valeurs.
- **Attachement effectif de la notice d'information — tranché et
  implémenté (2026-08-24).** Décision : (A) mention textuelle
  inconditionnelle en section PIECES ANNEXEES ("Une notice d'information
  relative aux droits et obligations des locataires et des bailleurs.",
  item 3 de la liste officielle) — jamais de fusion de fichiers, incohérent
  avec le pattern déjà établi dans toute l'app (l'utilisateur assemble
  lui-même le dossier final) ; (B) le PDF lui-même (arrêté du 29 mai 2015,
  modifié par l'arrêté du 16 février 2023 — seule source officielle
  identifiée : aucun PDF distinct de l'export Légifrance n'existe, ni sur
  service-public.gouv.fr ni sur les sites préfectoraux, qui renvoient tous
  vers le même texte Légifrance) est hébergé comme fichier fixe, public,
  non rattaché à une entité — `references/notice-information-bail.pdf`
  dans le même bucket Object Storage que les documents, jamais chiffré
  (aucune donnée utilisateur), aucune ligne `documents` (nouveau module
  `apps/backend/src/references`, réutilise `DocumentStorageService` en
  instance séparée — jamais `DocumentsModule` en entier, qui dépend de
  Postgres sans rapport avec ce cas). Script réutilisable
  `pnpm upload:notice-information` pour les futures mises à jour de
  l'arrêté. Boutons desktop ("Générer le document" du bail — jusqu'ici
  totalement absent de l'UI, seul l'endpoint existait — et "Télécharger la
  notice d'information") ajoutés ensemble dans `BailActuelDetail`
  (BailTabs.tsx), même zone que Activer/Résilier le bail.

### État des lieux (en cours, priorité 2)

Porte, en plus de son objet propre (constat d'entrée/sortie par pièce),
l'inventaire de mobilier à liste légale fermée (décret n° 2015-981)
volontairement différé depuis le module "Édition d'un bail" ci-dessus —
les deux modules partagent ce même concept de données.

**Schéma validé (2026-08-03), voir docs/data-dictionary.md pour le
détail complet des tables.** Contenu vérifié contre le texte exact du
décret n° 2016-382 (art. 2 et 3 — pas de modèle officiel annexé,
contrairement au contrat-type de bail) et contre le modèle Word réel du
propriétaire (`tmp/Modèle état des lieux.docx`), pas une synthèse
générale. Trois approches de schéma comparées (catalogue de
types/éléments en base, modélisation littérale, hybride avec règle
métier en TypeScript) — **modélisation littérale retenue** (une table
par groupe de pièce), le décret et le modèle du propriétaire étant
fixes, la flexibilité des deux autres approches ne serait jamais
exploitée.

**Backend validé (2026-08-06) : `EtatsDesLieuxModule` (`apps/backend/src/etats-des-lieux`).**
Un endpoint de soumission par pièce (`PATCH /etats-des-lieux/:id/piece-*`,
upsert sur `etat_des_lieux_id` seul pour entrée/séjour/cuisine/compteurs,
sur `(etat_des_lieux_id, numero)` pour chambres/salles de bain/wc/autres
pièces) — cohérent avec la résilience réseau décidée ci-dessous. Clés,
équipements divers et inventaire meublé en `PATCH` d'**upsert par id
explicite** (pas un remplacement en bloc — revu le 2026-08-06 après
relecture critique, voir docs/data-dictionary.md pour le raisonnement
complet : un simple delete-puis-réinsertion de la liste à chaque
soumission aurait pu silencieusement effacer les valeurs d'entrée si une
soumission de sortie, des mois plus tard, ne renvoyait pas toutes les
lignes déjà connues — et contournait de plus le timbrage d'audit,
`mettreAJourAvecAudit`, en faisant un `DELETE` brut sur une table métier).
DTOs en objets imbriqués par élément (`{ mur: { description, etatEntree,
etatSortie } }`) alors que le schéma reste plat en base — le service fait
le pont. Photos réutilisent le module Documents existant
(`document_entite_type = 'etat_des_lieux'`), aucun nouveau mécanisme de
stockage. Catalogue `elements_inventaire_meuble` seedé (88 lignes, voir
docs/data-dictionary.md). Vérifié par un test d'intégration Postgres réel
(15 tests, `etats-des-lieux.integration.spec.ts`), y compris le scénario
de régression exact (entrée préservée après une soumission de sortie qui
ne la mentionne pas). Endpoint `GET /etats-des-lieux/catalogue-inventaire`
ajouté au passage (route littérale déclarée avant `:id`), nécessaire à la
fois à la vue de relecture desktop et au futur parcours mobile.

**Desktop validé (2026-08-06) : `EtatDesLieuxSection` (`apps/desktop/src/renderer/src/etats-des-lieux`),
intégrée dans `BailActuelDetail` (`patrimoine/BailTabs.tsx`).** Tableaux
denses par pièce (entrée/séjour/cuisine en 1:1, chambres/salles de
bain/wc/autres pièces en multi-instance avec bouton d'ajout jusqu'au
maximum du modèle réel), compteurs, clés, équipements divers, inventaire
meublé (si bail meublé). Les lignes archivées de clés/équipements/
inventaire passent par le même `ArchiveToggle`/`ArchiveBadge` partagé que
le reste de l'app (`components/ArchiveFilter.tsx`) — ce qui a exigé
d'ajouter un paramètre `avecArchives` sur `findById`/`findByBailId`
côté backend (masquées par défaut, sinon invisibles pour de bon).

Bug trouvé en test manuel réel (2026-08-06) : cliquer sur "Ajouter" (une
pièce, une clé "autre", un équipement) faisait remonter la page tout en
haut malgré un ajout fonctionnel. Cause réelle diagnostiquée dans le code
(pas devinée) : chaque "Ajouter"/"Enregistrer" appelle `refresh()`, qui
posait `setIsLoading(true)` à **chaque** appel — pas seulement au premier
montage — démontant tout le contenu dense de la section au profit d'un
`<p>Chargement…</p>` d'une ligne, ce qui fait perdre au navigateur sa
hauteur de défilement et ramène le scroll en haut sans jamais le
restaurer. Corrigé en distinguant le premier chargement (seul cas
démontant l'arbre) des rafraîchissements silencieux ultérieurs (`useRef`
`premierChargementEffectue`) — plus de démontage, donc plus de perte de
position de défilement, re-testé et confirmé à l'écran.

**Saisie numérique uniquement (téléphone/desktop), jamais sur papier —
chantier d'interface à part entière, conçu après le schéma.** Parcours
mobile en pas-à-pas pièce par pièce, M/P/B/TB en boutons tactiles larges
(jamais un menu déroulant), une seule colonne d'état affichée à la fois
(la valeur d'entrée en lecture seule sert de référence à la sortie),
commentaire replié par défaut, indicateur de progression, bouton photo
par pièce (pas par élément, réutilise l'attachement polymorphe du
Module 4). Vues distinctes sur la même donnée : mobile en pas-à-pas
(l'outil de capture réel sur place), desktop en tableau dense (relecture
et correction après coup).

Accès mobile : page web légère sur l'API REST d'`apps/backend`, décision
et raisonnement complets dans `docs/app-spec.md` (section 3). Résilience
réseau : soumission indépendante par pièce (et par photo), blocage
explicite avec message clair et bouton "Réessayer" en cas d'échec —
aucune file d'attente de synchronisation ni colonne de statut à
maintenir, le problème réseau reste visible et actionnable sur place
pendant la visite plutôt que découvert après coup.

**Package créé (2026-08-03) : `apps/mobile-web`, structure et routes de
base seulement — pas encore les écrans réels de saisie.** Stack
Vite + React + TypeScript comme `apps/desktop`, dépendance à
`packages/core`. `VITE_API_URL` câblé dès la structure initiale, même
mécanisme que `apps/desktop` (`vite.config.ts` échoue bruyamment à la
construction si absent en build de production, jamais de repli
silencieux vers `localhost` — voir docs/error-log.md). `BrowserRouter`
(URLs propres) plutôt que `HashRouter` (utilisé côté desktop pour une
raison propre à Electron, sans objet ici).

**Composition de l'appartement — nouvelle source de vérité (2026-08-07) :**
`appartements.nombre_chambres` / `nombre_salles_de_bain` / `nombre_wc`
(integer, nullable) et `autre_piece_1` / `autre_piece_2` (texte, nullable),
migration additive standard, même famille que `type_energie`/`chauffage`.
Modifiables uniquement depuis la fiche appartement existante (Module 2,
pas de champ à la création — même logique que `equipementCuisine`/
`dependancesAnnexes`). Le parcours mobile lit cette configuration au
démarrage et en déduit automatiquement le nombre et l'ordre des étapes
("Entrée 1/N") — jamais redemandée, jamais devinée. Les deux "autres
pièces" sont des emplacements fixes (numéro 1/2 sourcés depuis
l'appartement), pas une liste libre : si l'agencement réel change (mur
abattu, pièce ajoutée), le propriétaire corrige la fiche appartement,
aucun mécanisme spécial construit pour ce cas rare.

Verrou de complétude avant de démarrer un état des lieux : même principe
que `validerCompletudeGenerationBail`, nouvelle fonction pure dédiée
`validerCompletudeEtatDesLieux` (`packages/core`) plutôt qu'une logique
parallèle — si chambres/salles de bain/WC ne sont pas renseignés,
`EtatsDesLieuxService.create()` bloque avec un message explicite listant
les champs manquants (`BadRequestException` + `champsManquants`) plutôt
que de lancer un parcours à zéro étape. `autre_piece_1`/`autre_piece_2`
volontairement hors du contrôle de complétude (légitimement vides).

Alignement rétroactif du desktop sur cette même source (demandé
explicitement avant de coder le mobile, pour éviter une double vérité) :
les tableaux multi-instance de la vue de relecture (chambres/salles de
bain/WC) utilisaient un maximum codé en dur — remplacé par
`appartement.nombreChambres ?? 3` etc. La section "autres pièces", qui
était un ajout libre en texte, a été entièrement remplacée par un flux à
deux emplacements fixes pilotés par `autrePiece1`/`autrePiece2` (un
bouton "+ Ajouter {libellé}" par emplacement non encore utilisé) — chaque
ligne déjà créée continue de renvoyer son propre libellé capturé, jamais
la valeur courante de la fiche appartement, pour ne pas relabelliser
rétroactivement un état des lieux déjà rempli si la fiche change plus
tard.

**Mobile validé (2026-08-07) : parcours pas-à-pas complet
(`EtatDesLieuxStepper`, `apps/mobile-web/src/etat-des-lieux`), le vrai
outil de capture terrain.** Une étape à la fois (jamais un long
formulaire qui scrolle), en-tête sticky "Titre N/Total" avec barre de
progression, pied sticky Précédent/Suivant. M/P/B/TB en 4 gros boutons
tactiles (`BoutonsEtatPiece`), bon/d'usage/mauvais en 3 boutons
(`BoutonsEtatInventaire`) — jamais de menu déroulant. Une seule colonne
d'état éditable à la fois selon `mode` (entrée tant que
`statut !== "entree_terminee"`, sinon sortie) ; à la sortie, la valeur
d'entrée s'affiche à côté en lecture seule (`ReferenceLectureSeule`).
Commentaire replié par défaut, un tap pour l'ouvrir (`ChampReplie`).
Bouton "+ Photo" par pièce (pas par élément), `input type="file"
capture="environment"`, upload immédiat et indépendant du flux de
soumission de l'étape, réutilise le module Documents existant
(`entiteType: "etat_des_lieux"`).

Résilience réseau : chaque étape expose un contrat `EtapeHandle.submit()`
(`forwardRef`/`useImperativeHandle`) déclenché uniquement par "Suivant" ;
en cas d'échec, blocage explicite avec message d'erreur et le bouton
devient "Réessayer" — jamais d'avancée à l'étape suivante sur un état non
confirmé enregistré côté serveur. Les champs description/nombre des
pièces sont partagés entre entrée et sortie dans le schéma (toujours
pré-remplis et renvoyés quel que soit `mode`) ; seul `etat` est
spécifique au côté actif — les compteurs, à l'inverse, ont des champs
entièrement dédiés par côté.

Vérifié par un test de bout en bout au niveau HTTP réel (pas simulé) :
connexion, appartement sans composition → verrou bloque avec le message
exact, composition renseignée → état des lieux créé, parcours d'entrée
complet (pièces, chambres, autre pièce, clés, compteurs, récap → statut
`entree_terminee`), puis une resoumission de sortie ne touchant qu'une
chambre et une clé → vérifié par relecture que les valeurs d'entrée des
lignes touchées sont préservées et qu'une ligne de clé non mentionnée
reste totalement intacte — le scénario exact qui avait motivé la
correction `upsertEtArchiverParId` de l'étape 2, revérifié à travers le
nouveau chemin de soumission mobile. `pnpm typecheck`/`lint`/`test`/
`test:integration` complets et propres sur tout le monorepo.

Hors de portée de cette vérification automatisée (nécessite un vrai
téléphone/navigateur, non pilotable depuis cet environnement) : rendu
visuel réel du parcours, taille effective des zones tactiles M/P/B/TB et
bon/d'usage/mauvais, comportement d'ouverture du commentaire replié,
comportement réel de `capture="environment"` sur un appareil physique,
disposition visuelle colonne unique + référence lecture seule à la
sortie, comportement visible du cycle Suivant/Précédent/Réessayer sous
coupure réseau simulée — vérification manuelle demandée au propriétaire,
comme pour le desktop.

**Correctif (2026-08-07) : photos non rattachées à leur pièce en
relecture desktop.** Trouvé par le propriétaire en testant l'écran réel
(photos visibles dans Documents mais isolées, sans lien avec la pièce
concernée dans `EtatDesLieuxSection`). Cause confirmée dans le code
réel avant correction : `PhotoButton` envoyait toujours `entiteId` =
l'en-tête `etats_des_lieux` (jamais une ligne de pièce précise), pour
une raison structurelle et pas un oubli — les lignes de pièce
n'existent qu'après soumission de l'étape mobile ("Suivant"), alors que
la photo part immédiatement à la sélection, potentiellement avant. Deux
colonnes nullables ajoutées sur `documents`
(`etat_des_lieux_piece_type`/`_numero`, voir data-dictionary.md) portées
par le parcours mobile dès l'étape courante (déterministe, indépendant
de l'existence de la ligne), avec garde-fou applicatif rejetant ces
champs pour tout `entiteType` autre que `etat_des_lieux`. La vue de
relecture desktop (`PieceGrid.tsx`, `EtatDesLieuxSection.tsx`) regroupe
les photos par `(type, numero)` et les affiche en liens directement dans
la `PieceCard` de la pièce concernée. Vérifié par un test HTTP réel :
photo envoyée pour "chambre 1" AVANT que la ligne existe en base →
upload accepté → soumission tardive de la ligne chambre 1 → la photo
s'associe correctement par correspondance de numéro, pas de clé
étrangère ; deuxième photo "chambre 2" et une photo "entrée" (sans
numéro) confirmées non mélangées ; garde-fou testé (pieceType refusé sur
`entiteType: "bail"`, 400). Pipeline complet propre.

**Génération du document légal état des lieux — construite et testée,
absente de cette section jusqu'ici (ajouté 2026-08-21).**
`EtatDesLieuxDocumentService` (`apps/backend/src/etat-des-lieux-document-docx/`)
génère le document réel (docxtemplater + pizzip, même pipeline que
`BailDocumentDocxService`), photos intégrées via `sharp` (retraitement
EXIF/PNG, voir la section "Insertion de photos dans le document généré"
ci-dessus — la dépendance est bien installée et utilisée, contrairement à
ce que cette section affirmait avant correction). Endpoint authentifié +
journalisation `journal_audit`, bouton "Générer" sur la vue de relecture
desktop, testé par un test d'intégration Postgres réel. Génération d'un
document complet réel (dossier `tmp/`) encore en cours de vérification au
moment de cette mise à jour — pas encore confirmée terminée.

**Hébergement définitif encore à trancher au provisionnement Scaleway
(tâche déjà en attente).** Deux options : servir les fichiers statiques
sur un sous-chemin d'`apps/backend`, ou un hébergement statique séparé.
**Préférence actuelle du propriétaire : sous-chemin du backend** — notée
ici pour ne pas repartir de zéro le moment venu, mais non figée tant que
le provisionnement Scaleway n'a pas eu lieu. `VITE_API_URL` reste la
seule indirection nécessaire pour ce choix : aucun autre changement de
code attendu quelle que soit l'option retenue.

**Insertion de photos dans le document généré — module choisi et
vérifié avant conception du schéma (2026-08-02).** Le besoin ("photos
intégrées dans le document imprimé") implique un module d'insertion
d'image pour docxtemplater, qui n'a rien de gratuit par défaut : le
module officiel (`docxtemplater.com/modules/image/`) est payant, 500 €/an
à l'unité ou 1250 €/an pour le plan PRO (4 modules au choix).

Alternative retenue : **`docxtemplater-image-module-free`** (npm, licence
MIT, fork communautaire maintenu de l'ancien module officiel devenu
payant, compatible `docxtemplater ^3.0.0` — notre version installée est
`3.69.3`). Décision prise seulement après un test d'intégration réel
contre notre pipeline exact (pizzip + docxtemplater), pas une simple
vérification de compatibilité déclarée :
- Template minimal construit à la main (balise `{%photo}` dans son propre
  paragraphe), rendu via `PizZip` + `Docxtemplater` + le module, sur une
  vraie photo JPEG (239×178, domaine public).
- Document `.docx` résultant converti en PDF **et** en PNG via LibreOffice
  headless (`soffice --headless --convert-to`) — pas seulement "le zip
  ne plante pas à la génération" : l'image est bien présente dans le PDF
  (filtre `/DCTDecode`, XObject Image) et visuellement correcte dans le
  rendu PNG, à la position et à la taille demandées (`getSize`).

**Deux gaps réels confirmés pendant ce test, tous les deux à traiter côté
notre code avant la conception du schéma État des lieux :**

1. **L'orientation EXIF n'est jamais appliquée — ni par le module, ni par
   le rendu.** Vérifié concrètement : une photo test réencodée avec un
   tag EXIF `Orientation=6` (rotation 90° — cas réel d'une photo de
   téléphone prise à la verticale) ressort et s'affiche **dans son
   orientation brute**, sans la rotation attendue. Ce n'est pas
   documenté dans le module (aucune mention d'EXIF dans son code ni sa
   doc) : il transmet les octets tels quels (confirmé — le fichier média
   intégré est strictement identique octet pour octet à la photo
   source). Jamais compter sur Word ou un autre lecteur pour corriger
   l'affichage automatiquement, le comportement est documenté comme non
   standardisé et incohérent d'un logiciel à l'autre.
2. **Bug confirmé du module : tout fichier média généré est nommé
   `image_generated_N.png` en dur** (`js/index.js`, `name = "image_generated_"
   + this.imageNumber + ".png"`), y compris quand les octets réels sont
   un JPEG — le paquet OOXML déclare alors `image/png` pour un contenu
   qui n'en est pas un. Constaté dans notre test (photo JPEG intégrée
   sous ce nom `.png`). LibreOffice l'a toléré (rendu correct, probable
   détection du format par les octets plutôt que par l'extension
   déclarée) — **non vérifié dans Microsoft Word réel**, seul rendu
   disponible dans cet environnement.

**Décision : redressement + réencodage fait une seule fois, à l'upload
de la photo (Module 4, Documents), pas à chaque génération/régénération
du document.** Chaque photo est stockée déjà propre (PNG véritable,
orientation EXIF déjà appliquée aux pixels, tag remis à 1/normal) — le
service de génération État des lieux ne fait alors que lire un fichier
déjà correct, sans jamais retraiter l'image. Réutilise le point de
passage déjà existant pour tout document uploadé (`EncryptionService`,
Module 4) : le pré-traitement image s'insère avant le chiffrement, une
seule fois par photo, jamais recalculé à la génération. Règle les deux
gaps ci-dessus d'un coup : orientation correcte + vrai PNG conforme à
son extension déclarée.

**Outil retenu pour ce pré-traitement : `sharp`, vérifié avant
d'ajouter la dépendance (même réflexe que pour
`docxtemplater-image-module-free`) :**
- **Licence Apache-2.0**, confirmé via le registre npm (`sharp@0.35.3`).
- Dépendance native `libvips`, licence **LGPL-2.1-or-later** — distribuée
  par `sharp` sous forme de binaires précompilés séparés
  (`node_modules/sharp/vendor`, liaison dynamique), le schéma standard qui
  permet un usage depuis du code propriétaire fermé sans obligation de
  publier ce code sous LGPL, tant que `libvips` lui-même n'est pas modifié.
  Sans incidence supplémentaire dans notre cas : `sharp` vivrait dans
  `apps/backend` (service cloud qu'on exploite nous-mêmes), jamais
  redistribué à un tiers comme bibliothèque ou binaire — le déclenchement
  des obligations de la LGPL suppose une distribution, absente ici.
- Binaires précompilés disponibles pour **Windows x64** (poste de dev) et
  **Linux x64** (déploiement Scaleway visé) — aucune compilation native
  requise à l'installation.
- Exige Node.js `>=20.9.0` ; le monorepo impose déjà Node `>=24`
  (`package.json` racine) — largement compatible.
- API exacte pour ce besoin : `sharp(buffer).rotate()` sans argument
  appelle `autoOrient()` — applique la rotation/le miroir selon le tag
  EXIF `Orientation` **puis supprime ce tag**, empêchant toute
  double-correction en aval. Suivi de `.png()` pour forcer un vrai PNG
  en sortie.
- **Ajouté en dépendance et effectivement utilisé — corrigé (2026-08-21,
  cette mention affirmait le contraire).** `sharp` figure dans
  `apps/backend/package.json` et est importé dans
  `etat-des-lieux-document-docx.service.ts` (ainsi que son test
  d'intégration) — voir plus haut, `EtatDesLieuxDocumentService`.

**Risque du fork non maintenu par l'auteur officiel de docxtemplater —
chemin de repli explicite.** `docxtemplater-image-module-free` est un
fork communautaire, pas le module officiel : si une future version de
docxtemplater casse la compatibilité, ou si le module se révèle
insuffisant à l'usage réel (au-delà des deux gaps déjà identifiés
ci-dessus), **la version payante officielle (500 €/an, module seul)
reste l'option de secours** — remplacement direct au niveau de
l'intégration (même famille de configuration `getImage`/`getSize`,
changement d'import), pas une réécriture depuis zéro. Ne pas
retarder cette bascule si le fork montre des signes d'abandon
(pas de commit depuis longtemps, incompatibilité avec une montée de
version de docxtemplater) — le coût annuel est faible comparé au risque
de bloquer la génération de documents légaux.

### Suivi des charges et fiscalité (futur module)

Objectif : suivi des dépenses par SCI, pour exploiter le régime fiscal
(IS/IR) déjà en base (Module 1) — actuellement décoratif sans ce module.

Portée envisagée :
- Import CSV des dépenses, réutilisant le moteur de rapprochement du
  Module 5 (`parserReleveCsv`, `proposerRapprochements`) plutôt qu'une
  nouvelle intégration bancaire — la synchronisation automatique via
  agrégateur DSP2 (Powens/Bridge) a été écartée en Phase 4 pour coût et
  complexité ; à reconsidérer consciemment si besoin, pas par défaut.
- Catégorisation : suggestion par règles simples (mots-clés sur libellé)
  avec confirmation manuelle obligatoire — même principe que le
  rapprochement des loyers, jamais d'application automatique silencieuse.
- Pièce jointe par dépense, via le lien polymorphe déjà existant du
  Module 4 (Documents).
- Objectif final : dashboard recettes vs dépenses, rentabilité nette par
  bien (actuellement affichés en revenu brut uniquement, Module 7).
- Les remboursements (dépôt de garantie, trop-perçu) ne sont visibles que
  dans l'onglet Bail, jamais agrégés dans une vue financière transversale
  (constaté lors du chantier motif de retenue dépôt de garantie,
  2026-08-24). Le futur module Charges et fiscalité devra inclure les
  remboursements comme flux financier sortant, au même titre que les
  futures charges/achats, pas seulement les loyers comme flux entrant —
  objectif : vue complète recettes (loyers) vs dépenses (remboursements,
  futures charges).

Ce module mérite sa propre phase de conception dédiée (comme les Phases
1-12 initiales) avant d'être développé — pas à traiter comme un ticket
parmi d'autres du backlog MVP.

### Intervention (futur module)

Objectif : calendrier de rendez-vous liés à un bien (RDV locataire,
visites, planification d'une intervention) — **sans aucun volet
financier** (pas de devis, pas de facture, pas de suivi de rentabilité).

**Distinct du Module Travaux du cahier des charges initial**
(`docs/app-spec.md`, Module 9 — devis/factures/rentabilité des travaux,
`docs/backlog.md`, "Hors backlog MVP") : les deux sujets sont volontairement
tenus séparés. Intervention reste un simple calendrier ; Travaux (avec son
volet financier) demeure hors backlog MVP, non encore priorisé.

Ce module mérite sa propre phase de conception dédiée avant d'être
développé — pas à traiter comme un ticket parmi d'autres du backlog MVP.

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
- Configuration PowerSync (Sync Rules de base) branchée sur Postgres
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

**Écart connu** : l'endpoint "modifier" du CRUD SCI listé ci-dessus n'a
jamais été implémenté — seuls create / findAll / findById / archiver
existent (`apps/backend/src/scis`). Identifié lors du Module 2, qui a
implémenté le CRUD complet (dont "modifier") pour Immeubles/Appartements/
Équipements. Reste à corriger dans un ticket dédié (backend + bouton
"Modifier" sur la fiche SCI) avant de considérer le Module 1 fidèle à sa
propre définition.

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
avant de considérer le module terminé. Deux points restent volontairement
non traités, risque jugé faible en usage mono-utilisateur desktop actuel,
à revisiter avant l'ouverture SaaS multi-utilisateur :
- Pas de verrou explicite (`SELECT ... FOR UPDATE`) ni d'index unique
  partiel Postgres sur `baux(appartement_id) WHERE statut IN ('actif',
  'preavis')` : deux appels concurrents à `activer()` pourraient en théorie
  passer tous les deux la vérification avant qu'aucun ne committe.
- `UpdateAppartementDto` permet toujours de forcer manuellement
  `statut: 'loue'` sans qu'un bail actif n'existe réellement (décision
  Module 2 assumée pour la correction de saisie) — rien ne garantit la
  cohérence entre `appartements.statut` et l'état réel de `baux` en dehors
  du chemin activer()/resilier().
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
- **Prérequis de conception, à valider avant de considérer ce module
  terminé** (identifié lors du correctif "Cas B" de `BauxService.resilier()`,
  `docs/data-dictionary.md` section `baux`) : ce module introduit la
  génération récurrente des échéances de loyer (une par mois, via le job
  planifié) — jusqu'ici, seule la toute première échéance était générée à
  l'activation d'un bail (`BauxService.activer()`). Avant de livrer ce job,
  décider explicitement comment traiter le **rattrapage des mois déjà
  écoulés sans échéance** pour tout bail actif AVANT la mise en service de
  ce job (plusieurs mois consécutifs ont pu s'écouler sans qu'aucune ligne
  de paiement n'existe pour eux, y compris au-delà du seul mois de
  résiliation que corrige déjà `resilier()` "Cas B") : facturer chaque mois
  manquant à taux plein ? les fusionner en une seule ligne de rattrapage ?
  Ce n'est volontairement PAS tranché aujourd'hui — le correctif "Cas B" ne
  couvre que le mois de résiliation lui-même, jamais un rattrapage
  multi-mois (limite de scope explicitement acceptée par l'utilisateur).

**Critère de complétion** : faire tourner le job deux fois de suite sur les
mêmes données, vérifier qu'aucune alerte n'est dupliquée — ET la décision
de rattrapage multi-mois ci-dessus explicitement tranchée et documentée
avant de considérer le module livré (pas seulement codé).

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

---

## Dette technique

- **Trop-perçu non traité à la résiliation d'un bail réglé en cours de mois**
  (identifié Module 5, lors de la conception de la proration des échéances ;
  complété après revue par financial-logic-reviewer sur ce même chantier).
  `BauxService.resilier()` proratise l'échéance de loyer du mois de
  `date_fin` uniquement si elle est encore `impaye`/`partiel`
  (`docs/data-dictionary.md`, section baux). Deux chemins mènent au même
  trop-perçu non traité, ni calculé, ni signalé, ni remboursé :
  1. L'échéance est déjà réglée intégralement (`statut=paye`) au moment de
     la résiliation : le système ne la touche pas du tout.
  2. L'échéance est `partiel` mais le montant déjà versé (`montant_paye`)
     dépasse le nouveau montant proratisé (plus petit que le montant
     mensuel plein) : le recalcul du statut (`calculerStatutPaiement`) la
     fait alors basculer à `paye`, ce qui est correct en soi (tout ce qui
     est dû est réglé), mais laisse le même trop-perçu résiduel non traité
     que le cas 1, sans qu'aucun test ni note ne le couvre jusqu'ici.
  Nécessite une notion de remboursement/avoir absente du modèle de données
  actuel (le dépôt de garantie mis à part). Candidat probable pour le
  Module 7 (régularisation) ou une extension ultérieure du modèle
  `paiements` — décision volontairement différée, pas un oubli.

- **Remboursement du dépôt de garantie — non modélisé.** Dépend de l'état
  des lieux de sortie (Module 4, Documents) et d'une logique de retenue sur
  dégradations constatées, proche d'une régularisation (esprit du Module 6
  du cahier des charges initial). À concevoir comme un vrai sujet à part
  entière avant l'ouverture du module correspondant — pas une simple ligne
  de paiement supplémentaire, implique une décision de calcul distincte du
  prorata de loyer déjà en place.

- **Aucune validation que `date_fin` ≥ `date_debut`/`date_activation` à la
  résiliation** (identifié par financial-logic-reviewer lors du correctif
  "Cas B" de `BauxService.resilier()`, gap préexistant dans le code
  d'origine du Module 5 — pas introduit par ce correctif).
  `ResilierBailDto` ne valide que le format de `dateFin` (`@IsDateString()`),
  jamais son ordre chronologique par rapport au début réel d'occupation du
  bail. Si `dateFin` est antérieure à `date_debut`/`date_activation`,
  `calculerProrataResiliation` ramène le nombre de jours occupés à 0 plutôt
  que de produire un montant négatif — le prorata (Cas A comme Cas B)
  produit alors silencieusement une ligne à 0,00 € (ou ne crée aucune ligne
  en Cas B, via le garde `montantEnCentimes(...) > 0`) au lieu de rejeter
  explicitement une résiliation antérieure au début d'occupation. Pas de
  perte financière constatée (aucun montant erroné positif), mais un
  comportement silencieux là où une erreur explicite serait plus sûre.
  À corriger : rejeter (`ConflictException`) une résiliation dont `dateFin`
  précède le début réel d'occupation, plutôt que de laisser le calcul
  absorber silencieusement l'incohérence.

---

## Hors backlog MVP (rappel, voir docs/app-spec.md section 5)

Charges, Révision INSEE, Travaux, IA, envoi automatique d'emails,
connexion bancaire automatique — feront l'objet de backlogs dédiés au
moment de leur développement, une fois le MVP livré.

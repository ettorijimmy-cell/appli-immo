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

- **Remboursement du dépôt de garantie — modélisé sommairement, motif de
  retenue toujours insuffisant.** Le chantier "versements & remboursements"
  a modélisé le remboursement lui-même (table `remboursements`, type
  `depot_garantie`, `docs/data-dictionary.md`), avec un simple champ
  `commentaire` texte libre pour justifier un écart entre montant reçu et
  montant remboursé (ex. retenue pour dégradations). **Ce champ n'est pas
  jugé suffisant** : le besoin réel est un motif de retenue **structuré**
  (catégorie de dégradation + pièce justificative attachée — photo,
  devis...), pas un texte libre non catégorisé, non exploitable pour des
  statistiques ou un futur contentieux. Rattachement naturel à un état des
  lieux de sortie **catégorisé** (Module 4, Documents — état des lieux
  existe comme document mais sans structure de catégories de dégradation
  aujourd'hui) : à concevoir comme un vrai sujet à part entière avant
  d'être codé, pas une simple extension du champ `commentaire` actuel.
  L'utilisateur a redemandé ce point explicitement le 2026-07-30, après la
  mise en place du remboursement sommaire — confirmant que ce n'est pas
  une fonctionnalité accessoire, mais un gap identifié et maintenu
  volontairement ouvert le temps de concevoir la structure de catégories
  avec lui.

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

- **Versioning des documents (historique des versions) — absent du MVP
  construit.** Prévu au cahier des charges initial, jamais retranscrit dans
  le backlog détaillé du Module 4 lors de la Phase 10 — un écart de
  transcription Phase 1 → Phase 10, pas une décision de scope délibérée à
  l'origine. Identifié lors du démarrage du Module 4 (docs/backlog.md),
  avant tout code : confirmé hors périmètre du Module 4 MVP tel que
  construit. Proposition déjà validée si/quand implémenté :
  `document_precedent_id` (auto-référence nullable vers `documents.id`),
  chaînant un nouvel upload à la version qu'il remplace — la version
  courante restant la seule non chaînée par une version plus récente,
  jamais de suppression physique de l'ancienne (cohérent avec CLAUDE.md).

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

- **Checklist documentaire — non construite.** Prévue au cahier des
  charges initial ("checklist documentaire", "indicateur visuel documents
  manquants"), jamais implémentée : identifié en concevant la carte
  "Documents expirés" du Module 7, qui n'affiche donc que les documents
  expirés (statut déjà calculé), jamais "manquants" (aucune notion de
  documents attendus par entité n'existe dans le modèle). Nécessite de
  définir explicitement quelles catégories de documents sont attendues par
  type d'entité (bail, appartement, locataire) et si elles sont
  obligatoires ou simplement recommandées — mérite sa propre réflexion
  avant développement, pas une règle improvisée dans un module tableau de
  bord.

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

### Édition d'un bail (futur module, priorité 1)

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

**Champs à ajouter (schéma non encore modifié — décisions arrêtées, pas
codées)** :
- `organisations` : adresse, code_postal, ville (le domicile du bailleur
  particulier est une mention obligatoire du contrat-type).
- `scis` : adresse, code_postal, ville (siège social) + nom/prénom du
  gérant (mention utile au bloc signature, pas une mention obligatoire du
  contrat-type lui-même). Gérant unique confirmé avec l'utilisateur —
  aucune SCI réelle à cogérance actuellement, donc pas de structure à
  plusieurs représentants légaux.
- `immeubles` : `type_habitat` (collectif/individuel), `regime_juridique`
  (mono_propriete/copropriete), `annee_construction` (integer, nullable) —
  ces trois mentions sont des caractéristiques du bâtiment, pas du lot,
  contrairement à une supposition initiale. `annee_construction` en année
  précise plutôt qu'en tranche officielle ("avant 1949", "1949-1974"...) :
  une fonction de dérivation dans `packages/core` calculera la tranche du
  contrat-type à l'affichage, testée sur les bornes exactes de chaque
  tranche (à vérifier précisément avant de coder, ne pas les supposer
  approximativement).
- `appartements` : `identifiant_fiscal` (texte), `nombre_pieces_principales`
  (integer, distinct du `type` T1-T6 déjà existant qui reste une
  catégorie commerciale, pas le décompte légal), `mode_chauffage` et
  `mode_eau_chaude` (individuel/collectif).
- `baux` : `travaux_realises` (texte, nullable) — mention obligatoire par
  nature spécifique à chaque bail, sans vocabulaire fixe possible ; gardé
  en base pour trace plutôt que non stocké du tout.
- Nouvelle table `diagnostics`, en 1:1 avec `documents` (FK `document_id`,
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
  affiché à la fois en section II.B (nouvelle mention) et en section VIII
  (motif de résiliation supplémentaire), uniquement à partir du 1er
  octobre 2026. À modéliser en base si le besoin se confirme.

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

### État des lieux (futur module, priorité 2)

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
- N'a **pas** été ajouté en dépendance à ce stade (`apps/backend` ne
  contient encore aucun code image) — à installer au moment de construire
  le point d'upload du module État des lieux, pas avant.

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

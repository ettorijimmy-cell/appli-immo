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

Pas encore conçu. Porte, en plus de son objet propre (constat d'entrée/
sortie par pièce), l'inventaire de mobilier à liste légale fermée (11
postes, décret n° 2015-981) volontairement différé depuis le module
"Édition d'un bail" ci-dessus — les deux modules partagent ce même
concept de données, à concevoir une seule fois ici plutôt qu'en double.

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

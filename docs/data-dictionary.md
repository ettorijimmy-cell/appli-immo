# Dictionnaire de données

Complète le schéma technique (packages/db) en donnant le sens métier de
chaque champ et les valeurs valides. À tenir à jour à chaque modification de
schéma — voir la règle correspondante dans CLAUDE.md.

Règles communes à toutes les tables métier : `id` (UUID v7), `created_at`,
`updated_at`, `updated_by`, `version`, `archived_at` (nullable). Aucune ligne
n'est jamais supprimée physiquement.

## organisations
| Champ | Type | Description |
|---|---|---|
| type | enum | `particulier` \| `syndic` |
| nom | text | Raison sociale ou nom |
| email_contact | text | |
| statut | enum | `actif` \| `archive` |

## organisation_sci
Table de liaison — une SCI peut avoir plusieurs organisations rattachées
dans le temps (propriétaire actuel + mandataire éventuel). Créée au
Module 0, avant la table `scis` (Module 1) ; la FK sur `sci_id` a été
ajoutée dans la migration du Module 1 une fois `scis` créée (migration
`0001_minor_gideon`). Le rattachement `proprietaire` est créé
automatiquement à la création d'une SCI — voir
`creerRattachementProprietaire` dans packages/core.
| Champ | Type | Description |
|---|---|---|
| role | enum | `proprietaire` \| `mandataire` |
| date_debut / date_fin | date | Période de validité du rattachement |

## scis
| Champ | Type | Description |
|---|---|---|
| regime_fiscal | enum | `IS` \| `IR` — jamais supposé, toujours explicite |
| forme_juridique | text | |
| siret | text | |
| statut | enum | `active` \| `archive` |

## comptes_bancaires_sci
| Champ | Type | Description |
|---|---|---|
| iban_chiffre | text | Chiffré au niveau applicatif (AES-256-GCM), jamais en clair |
| bic_chiffre | text | Idem |

## immeubles
| Champ | Type | Description |
|---|---|---|
| statut | enum | `actif` \| `archive` |

## appartements
| Champ | Type | Description |
|---|---|---|
| type | enum | `T1` \| `T2` \| `T3` \| `T4` \| `T5+` |
| statut | enum | `vacant` \| `loue` \| `travaux` \| `archive` |
| loyer_reference | decimal | Loyer de référence hors charges, utilisé pour pré-remplir un nouveau bail |

## equipements
| Champ | Type | Description |
|---|---|---|
| type | enum | `chaudiere` \| `ballon_eau_chaude` \| `autre` (extensible) |
| date_dernier_entretien | date, nullable | Sert de base au calcul de l'alerte entretien_equipement (Module 6) |
| intervalle_entretien_mois | integer, nullable | Périodicité attendue en mois, saisie librement (pas de valeur par défaut par type d'équipement) — l'alerte entretien_equipement ne se déclenche **jamais** tant que ce champ ou `date_dernier_entretien` est absent |

## locataires
| Champ | Type | Description |
|---|---|---|
| statut | enum | `actif` \| `ancien` \| `archive` |
| anonymise_le | timestamp, nullable | Renseigné lors d'une anonymisation RGPD — les champs identifiants sont alors neutralisés, la ligne reste |

## garants
| Champ | Type | Description |
|---|---|---|
| type_garantie | enum | `personne_physique` \| `garantie_visale` \| `autre` |

## baux
Le passage du statut à `actif` (activation) et `resilie` (résiliation)
déclenche la transition automatique du statut de l'appartement associé
(`vacant` ↔ `loue`) — voir packages/core, `peutActiverBail` et
`calculerStatutAppartementApresResiliation`. Ces deux transitions sont les
seules voies pour changer `statut` : jamais via une mise à jour générique du
bail (`apps/backend/src/baux/baux.service.ts`, `UpdateBailDto` ne porte pas
ce champ).
| Champ | Type | Description |
|---|---|---|
| type_bail | enum | `vide` \| `meuble` |
| statut | enum | `brouillon` \| `actif` \| `preavis` \| `resilie` \| `archive` |
| loyer_mensuel | decimal, nullable | Loyer **hors charges** (HC) — pré-rempli depuis `appartements.loyer_reference` à la création si non saisi explicitement (packages/core, `preremplirLoyerBail`) ; reste modifiable ensuite |
| depot_garantie | decimal, nullable | |
| provisions_charges | decimal, nullable | Provisions mensuelles pour charges, en plus du loyer HC. `null` traité comme `0` dans tout calcul (jamais de distinction "pas de charges" vs "charges non renseignées" au niveau calcul, seulement au niveau saisie) |
| jour_echeance | integer, nullable, 1-28 | Jour du mois auquel une échéance de loyer **récurrente** (2e mois et suivants) tombera, une fois le job du Module 6 construit. **N'a aucun effet sur la première échéance** (ni son montant, ni sa date d'exigibilité — voir décision ci-dessous) : c'est précisément la confusion qui causait le bug d'origine (échéance d'entrée calculée sur le jour d'activation au lieu de `date_debut`). Borné à 28 pour rester valide sur tous les mois. Renseignable progressivement comme `loyer_mensuel`/`depot_garantie`, mais **obligatoire pour activer** un bail (`BauxService.activer()` refuse si `null`) — uniquement pour ne jamais activer un bail qui ne pourrait plus jamais être facturé une fois le Module 6 construit, pas pour la première échéance elle-même |
| date_activation | date, nullable | Posée une seule fois par `BauxService.activer()`, jamais modifiée ensuite (absente d'`UpdateBailDto`). Trace historique du moment administratif de l'activation — **n'entre plus dans aucun calcul financier** (ni la première échéance, ni la résiliation, voir décisions ci-dessous). `null` pour les baux passés à `actif` avant l'introduction de cette colonne (migration 0007, sans backfill) |
| date_resiliation | timestamp with time zone, nullable | Posée une seule fois par `BauxService.resilier()`, jamais modifiée ensuite (absente d'`UpdateBailDto`) — même principe d'immutabilité que `date_activation`. **N'entre dans aucun calcul financier** : sert uniquement au frontend (`BailActuelTab`) pour identifier, parmi **plusieurs baux résiliés sur un même appartement** (historique de locataires successifs), celui qui vient d'être résilié à l'instant, afin d'y donner accès au dépôt de garantie et aux remboursements (section "versements & remboursements" ci-dessous). Timestamp (pas une simple date) : contrairement à `date_fin` (date métier de fin d'occupation), qui peut coïncider entre deux baux différents et ne départage donc pas de façon fiable, `date_resiliation` est toujours strictement croissante d'une résiliation à l'autre. `null` pour les baux résiliés avant l'introduction de cette colonne (migration 0013, sans backfill) — **repli explicite sur `updated_at` pour ces seuls cas legacy**, jamais la méthode de tri normale (bug réel constaté : sans tri du tout, un ordre de scan SQL non garanti pouvait faire apparaître le bail résilié d'un ancien locataire à la place de celui qu'on venait de résilier) |

**Décision produit (génération des échéances à l'activation, tranchée avec l'utilisateur — révisée après un bug réel constaté en test manuel)** :
- Chaque échéance de loyer correspond à un **mois calendaire complet** (1er au dernier jour). Seule la **première** est proratisée, et uniquement si `date_debut` ne tombe pas le 1er du mois — jamais en fonction du jour d'activation ni de `jour_echeance`, qui n'ont d'effet sur AUCUNE des deux lignes générées à l'activation.
- À l'activation d'un bail (`BauxService.activer()`), deux lignes de `paiements` sont générées dans la même transaction que le passage à `actif`, **toutes deux exigibles à `date_debut`** (l'entrée réelle dans les lieux, jamais la date d'activation administrative qui peut lui être largement postérieure — un bail peut rester en `brouillon` des semaines ou des mois après sa date de début contractuelle) :
  1. Dépôt de garantie, si `depot_garantie > 0` : `type=depot_garantie`, `montant=depot_garantie`, `date_echeance=date_debut`.
  2. Première échéance de loyer : `type=loyer`, `date_echeance=date_debut`. `montant = loyer_mensuel + (provisions_charges ?? 0)` si `date_debut` tombe le 1er du mois ; sinon proratisé du jour de `date_debut` jusqu'à la fin de ce mois calendaire (packages/core, `calculerMontantEcheanceEntree`, qui réutilise `calculerProrataOccupationPartielle` — la même fonction que la résiliation, renommée car son usage dépasse maintenant la seule sortie).
  - Les échéances suivantes ne sont **jamais** générées d'avance : elles seront produites par le job planifié quotidien du Module 6 (moteur d'alertes, `docs/backlog.md`), qui n'existe pas encore au moment de cette décision — c'est à ce moment-là que `jour_echeance` entrera enfin en jeu.
- Le dépôt de garantie (`type=depot_garantie`) ne compte **jamais** comme un impayé au sens des futures alertes/indicateurs (Module 6/7) — seules les échéances `type=loyer` (et `charges`) sont concernées par cette notion.

**Décision produit (prorata à la résiliation, tranchée avec l'utilisateur)** :
- À la résiliation (`BauxService.resilier()`), deux cas selon qu'une échéance de loyer couvre déjà ou non le mois calendaire de `date_fin` :
  - **Cas A — une échéance existe déjà pour ce mois** : elle est recalculée au prorata, **uniquement si son statut est encore `impaye` ou `partiel`** :
    `nouveau_montant = (loyer_mensuel + provisions_charges) × jours_occupes / jours_du_mois`, tronqué à deux décimales (jamais d'arrondi flottant, même convention que `montantEnCentimes`).
    **Convention légale à valeur de prorata temporis, non négociable sans nouvelle décision** : `jours_occupes` compte les jours **du début du mois jusqu'à `date_fin` inclus** — le jour du départ est facturé en entier, pas exclu. **Exception explicite** : si `date_debut` tombe dans le **même mois calendaire** que `date_fin` (bail résilié le mois même de son entrée — l'échéance couvrant ce mois est alors nécessairement l'échéance d'entrée, déjà proratisée depuis `date_debut`), `jours_occupes` se compte **depuis `date_debut`**, pas depuis le 1er du mois — sans quoi le montant serait proratisé une seconde fois sur une base déjà partielle (bug réel corrigé après revue financial-logic-reviewer : un bail entré et résilié le même jour facturait 238,80 € au lieu de 29,03 € pour un loyer de 900 €). `calculerProrataOccupationPartielle` reçoit toujours `date_debut` en troisième argument (`dateDebutOccupation`) ; cette exception ne s'applique — par construction de la fonction — que lorsque les deux dates tombent le même mois, sinon le comportement décrit ci-dessus (depuis le 1er du mois) reste inchangé.
    Si cette échéance est déjà réglée intégralement (`statut=paye`) au moment de la résiliation, elle **n'est pas touchée automatiquement** — voir `docs/backlog.md`, dette technique, pour le cas du trop-perçu non traité.
  - **Cas B — aucune échéance ne couvre ce mois** : `resilier()` **génère la ligne manquante**, toujours proratisée **depuis le 1er jour** du mois de `date_fin` (jamais depuis `date_activation` ni `date_debut`) — règle sans ambiguïté : le mois de `date_debut` est **exclusivement** traité par le Cas A (l'échéance d'entrée, toujours générée pour ce mois précis dès l'activation, voir décision ci-dessus), donc tout mois que le Cas B doit encore combler est nécessairement postérieur, occupé en continu depuis son 1er jour. `date_echeance=date_fin`, statut `impaye` par défaut. Aucune ligne n'est créée si le montant proratisé est nul.
    **Portée volontairement limitée** : seul le mois de `date_fin` est comblé. Si plusieurs mois consécutifs n'ont jamais eu d'échéance générée (écart de plusieurs mois entre l'activation et la résiliation, en l'absence du job du Module 6), les mois intermédiaires restent non facturés — un rattrapage multi-mois n'est pas traité ici, c'est le rôle du Module 6 une fois construit (voir `docs/backlog.md`, prérequis de conception posé sur ce module).

**Décision produit (génération récurrente des échéances, Module 6, tranchée
avec l'utilisateur — prérequis posé lors du Module 5)** :
- Le job planifié quotidien (`docs/backlog.md`, Module 6) génère, pour tout
  bail `actif`/`preavis`, l'échéance de loyer du **mois calendaire
  courant** si elle n'existe pas déjà (même critère d'existence que Cas A/B
  ci-dessus : une échéance `type=loyer` dont `date_echeance` tombe dans ce
  mois, peu importe sa source — `activer()`, `resilier()`, ou une
  exécution antérieure du job — rend l'opération naturellement idempotente
  sans état supplémentaire à suivre). Montant = `loyer_mensuel +
  (provisions_charges ?? 0)` (`calculerMontantEcheanceLoyer`),
  `date_echeance = <mois-courant>-jour_echeance`, statut `impaye`.
- **Aucun rattrapage automatique des mois déjà écoulés avant la première
  exécution du job.** Si un bail actif depuis plusieurs mois n'a aucune
  échéance pour les mois antérieurs (aucun job n'existait encore pour les
  générer), ces mois-là ne sont **jamais** comblés automatiquement — ni au
  premier passage du job, ni plus tard. Raison : la quasi-totalité des
  loyers concernés (usage réel de l'application) ont très probablement déjà
  été perçus hors logiciel, faute d'outil pour les tracer plus tôt ; les
  facturer automatiquement créerait de fausses lignes `impaye` et de
  fausses alertes. Le rattrapage de ces mois-là reste une action
  **manuelle et explicite** de l'utilisateur, via le formulaire de création
  de paiement existant (Module 5), avec le statut qu'il sait être le bon
  (`paye` ou `impaye`) — jamais une décision automatique du système.
- **Le mois courant, lui, n'est jamais sauté** — y compris à la toute
  première exécution du job, même si `jour_echeance` est déjà dépassé dans
  ce mois (ex. job déployé le 20 avec `jour_echeance=5`) : l'échéance du
  mois courant est générée quand même, datée du `jour_echeance` déjà passé
  (donc immédiatement visible comme en retard) — seuls les mois
  **antérieurs** au mois courant au moment de la première exécution sont
  concernés par la règle de non-rattrapage ci-dessus, jamais le mois en
  cours.
- Garde-fou : le job ne génère jamais une échéance pour un mois antérieur
  au mois de `date_debut` du bail (n'a de sens que si un bail est passé
  `actif` avec une `date_debut` future — cas normalement inexistant en
  usage correct, mais évite une échéance absurde le cas échéant).

**Décision produit (taux d'occupation, Module 7, tranchée avec
l'utilisateur)** : pour un appartement, sur une période donnée,
`calculerTauxOccupation`/`calculerJoursOccupes` (packages/core)
reconstituent l'occupation réelle depuis l'historique complet des baux
(pas seulement le bail courant) :
- Un bail ne contribue que si `date_activation` n'est pas `null` — un bail
  jamais activé (`brouillon`, y compris archivé directement depuis
  `brouillon`) n'a jamais été réellement occupé, quel que soit son
  `statut` actuel.
- Un bail contributeur occupe `[date_debut, date_fin]` — un bail `preavis`
  compte occupé jusqu'à sa `date_fin` **exactement comme n'importe quel
  bail dont `date_fin` est renseignée**, jamais tronqué à la date du jour
  (aucun traitement spécial par statut n'est nécessaire, ni souhaitable).
  Si `date_fin` est absente (bail encore `actif`/`preavis` en cours, ou
  cas rare d'un bail déjà `resilie`/`archive` sans `date_fin` renseignée —
  `ResilierBailDto.dateFin` est optionnel), l'occupation est considérée se
  prolonger au moins jusqu'à la fin de la période demandée : exact pour un
  bail réellement en cours, **approximation optimiste assumée** pour le
  cas rare d'une résiliation sans date renseignée (voir `docs/backlog.md`,
  dette technique sur l'absence de validation `date_fin`).
- Les intervalles de tous les baux contributeurs sont fusionnés en une
  **vraie union** (jamais une simple somme des durées) avant de compter les
  jours : deux baux qui se chevaucheraient dans les données (saisie
  erronée, ou chevauchement volontaire lors d'une transition de locataire)
  ne comptent jamais deux fois le même jour occupé.
- Agrégation SCI/immeuble : moyenne des taux d'occupation par appartement,
  pondérée par le nombre de jours de la période (identique pour tous les
  appartements dans la pratique, puisque tous calculés sur la même
  période demandée).

## bail_locataires
Table de liaison pour gérer la colocation.
| Champ | Type | Description |
|---|---|---|
| role | enum | `titulaire` \| `colocataire` |

## documents
| Champ | Type | Description |
|---|---|---|
| entite_type | enum | `sci` \| `immeuble` \| `appartement` \| `locataire` \| `bail` — lien polymorphe. Pas de contrainte de clé étrangère possible (5 tables cibles) : `DocumentsService.upload()` vérifie applicativement que `entite_id` existe bien dans la table correspondant à `entite_type` avant d'insérer |
| entite_id | uuid | Voir `entite_type` ci-dessus |
| categorie | enum | `bail` \| `assurance` \| `etat_des_lieux` \| `diagnostic` \| `dpe` \| `piece_identite` \| `rib` \| `caf` \| `quittance` \| `courrier` \| `photo` |
| statut | enum | `valide` \| `expire` \| `archive` — voir décision produit ci-dessous : `archive` seul est réellement écrit en base, `valide`/`expire` sont calculés à la lecture |
| date_expiration | date, nullable | Alimente le moteur d'alertes (Module 6) et le calcul de `statut` |
| nom_fichier | text | Nom original du fichier, affiché et utilisé pour la recherche plein texte de l'écran Documents |
| mime_type | text | Type MIME déclaré à l'upload, renvoyé tel quel au téléchargement (`Content-Type`) |
| taille_octets | integer | Taille du fichier original (avant chiffrement) |
| chemin_stockage | text | Clé/chemin du blob chiffré sur le stockage configuré (voir décision ci-dessous) — jamais exposé au frontend, uniquement interne à `DocumentsService`/`DocumentStorageService` |

**Décision produit (stockage, tranchée avec l'utilisateur)** : Scaleway Object
Storage n'est pas provisionné (Module 0, différé). Repli temporaire : chaque
document est chiffré (AES-256-GCM, `EncryptionService.encryptBuffer` —
`apps/backend/src/crypto`, mêmes clé/algorithme que l'IBAN/BIC) puis écrit
sur disque local sous un nom opaque (UUID aléatoire, indépendant de l'id de
la ligne `documents`), dans un dossier configurable
(`DOCUMENTS_STORAGE_DIR`, repli par défaut sur `storage/documents` relatif
au dossier `apps/backend` — voir `.env.example`). **Ceci est un repli
temporaire explicitement identifié comme tel, à migrer vers Scaleway Object
Storage une fois provisionné — pas une solution finale.** Le contenu en
clair n'est accessible que via `GET /documents/:id/contenu`, route
authentifiée qui journalise l'accès dans `journal_audit`
(`AuditService.logAccesDocumentSensible`, même mécanisme que l'IBAN/BIC),
jamais via une URL publique ou un chemin de fichier exposé au frontend
(CLAUDE.md, section Règles importantes).

**Décision produit (statut `expire`, tranchée avec l'utilisateur)** : le job
planifié quotidien qui fera de `expire` un fait réellement persisté n'existe
pas encore (Module 6). En attendant, `documents.statut` en base ne contient
jamais `expire` : seule sa valeur par défaut `valide` et la valeur explicite
`archive` (écrite par `DocumentsService.archiver()`) y sont réellement
écrites. `valide`/`expire` sont calculés à chaque lecture par
`calculerStatutDocument` (packages/core, pure, sans effet de bord) à partir
de `date_expiration` comparée à la date du jour — `archive` prime toujours
sur ce calcul. Le Module 4 satisfait ainsi son critère de complétion
("vérifier qu'un document expiré change bien de statut") via l'API, sans
qu'aucune écriture ne soit nécessaire ; le Module 6 réutilisera cette même
fonction telle quelle pour, lui, réellement persister `expire` via son job
quotidien. Convention de bord : le jour de `date_expiration` lui-même est
encore valide (expiration en fin de journée) — `expire` seulement à partir
du lendemain.

**Écart connu (identifié au démarrage du Module 4)** : le versioning des
documents (historique des versions) était prévu au cahier des charges
initial mais n'a jamais été retranscrit dans `docs/backlog.md` lors de la
rédaction détaillée du Module 4 — absent du MVP construit. Voir
`docs/backlog.md`, section dette technique, pour la proposition déjà
validée (`document_precedent_id`) si/quand implémenté.

## paiements
Rattaché à un bail (`baux`, Module 3). `montant` est la somme attendue à
l'échéance ; `montant_paye` / `mode` / `date_paiement` ne sont renseignés
qu'une fois le paiement effectivement enregistré. `statut` est calculé,
jamais saisi directement (packages/core, `calculerStatutPaiement`) :
`impaye` si `montant_paye` est nul, `paye` si `montant_paye >= montant`,
`partiel` sinon.
| Champ | Type | Description |
|---|---|---|
| type | enum | `loyer` \| `charges` \| `depot_garantie` |
| mode | enum, nullable | `virement` \| `cheque` \| `especes` \| `caf` |
| statut | enum | `paye` \| `impaye` \| `partiel` |
| montant | decimal | Somme attendue à l'échéance |
| montant_paye | decimal, nullable | Somme réellement reçue |
| date_echeance | date | |
| date_paiement | date, nullable | |
| reference_rapprochement | text, nullable | Renseigné après un rapprochement confirmé (import CSV) : la référence/le libellé de la ligne de relevé retenue. Jamais comparé en amont à une valeur attendue — voir la décision ci-dessous sur le critère "référence" du rapprochement. |

**Décision produit (Module 5, tranchée avec l'utilisateur)** : le critère
"référence" du rapprochement bancaire (`packages/core`,
`proposerRapprochements`) compare le libellé d'une ligne de relevé CSV au
nom/prénom du ou des locataires du bail concerné (correspondance partielle,
insensible à la casse et aux accents — tolère troncatures/abréviations
bancaires). Deux règles non négociables, à ne jamais régresser :
1. Un rapprochement n'est **jamais appliqué automatiquement**, même en cas
   de correspondance apparemment évidente sur les trois critères — le
   moteur ne fait que proposer, une confirmation humaine explicite est
   requise pour écrire quoi que ce soit (cohérent avec "semi-automatique",
   docs/backlog.md Module 5).
2. En cas d'ambiguïté (plusieurs baux candidats à montant/date identiques
   sans que le nom ne départage clairement, ou aucun nom ne correspond),
   **tous** les candidats sont présentés à l'utilisateur — jamais de choix
   silencieux, jamais de paiement laissé sans suggestion visible s'il y a
   au moins un candidat montant+date.

**Décision produit ("Provisions collectées" du Module 7, tranchée avec
l'utilisateur)** : `montant`/`montant_paye` ne distinguent **jamais** loyer
et provisions_charges pour une échéance `type=loyer` — une seule colonne,
les deux parts y sont fondues dès la génération (`calculerMontantEcheanceLoyer`).
Le montant de provisions réellement perçu est donc une **estimation
dérivée**, jamais une valeur stockée, calculée par
`calculerProvisionsRecuesEcheance` (packages/core) :
`provisions_reçues = montant_reçu × (provisions_charges / (loyer_mensuel + provisions_charges))`,
appliquée à `montant_paye` (ou `montant` si l'échéance est intégralement
payée) pour chaque paiement `type=loyer` de la période. Cette formule
proportionnelle règle complètement deux limites d'une approche forfaitaire
(`provisions_charges × nombre d'échéances payées`) :
- **Échéances proratisées** (entrée, résiliation) : la proportion s'applique
  au montant réellement dû sur le mois partiel, jamais à un forfait mensuel
  plein qui surestimerait la part provisions d'un mois incomplet.
- **Paiements partiels** : la part provisions est calculée sur ce qui a été
  réellement reçu, pas sur le montant total dû.

**Limite résiduelle, non réduite par cette formule — à ne jamais présenter
comme résolue** : `loyer_mensuel`/`provisions_charges` utilisés sont les
valeurs **actuelles** du bail (`baux`), jamais un instantané historique de
ce qu'elles valaient au moment où chaque échéance a été générée (non
stocké). Si ces valeurs ont été révisées en cours de bail, le ratio
appliqué à une échéance antérieure à la révision est **tout aussi faux**
qu'un montant forfaitaire l'aurait été — l'amélioration apportée par la
formule proportionnelle ne porte que sur le prorata et les paiements
partiels, pas sur ce point, qui reste entier.

**Hors périmètre de ce calcul** : les paiements manuels `type=charges`
(distincts des échéances `type=loyer` groupées) existent dans le modèle
(`CreatePaiementDto` les autorise) mais ne sont **jamais** additionnés à
"Provisions collectées" — pas parce qu'ils sont sans intérêt, mais parce
qu'ils appartiennent au futur module "Suivi des charges et fiscalité"
(voir `docs/backlog.md`, section Modules futurs) qui leur donnera un vrai
traitement, pas une simple addition à une estimation dérivée d'une autre
nature.

**Décision produit ("Revenus locatifs" du Module 7, tranchée avec
l'utilisateur)** : le graphique principal du tableau de bord affiche le
**loyer net** (`calculerLoyerNetRecuEcheance`, packages/core — part
provisions exclue), jamais le montant brut total encaissé. Les
"Provisions collectées" (décision ci-dessus) sont affichées **séparément**
: les deux sections ne se recoupent jamais, leur somme reconstitue
exactement le montant total réellement encaissé (`loyerNet + provisions =
montantRecu`, garanti par construction — les deux fonctions partagent la
même soustraction en centimes entiers, jamais deux ratios indépendants qui
pourraient dériver l'un de l'autre par arrondi).

Base de calcul : **date d'encaissement réel** (`date_paiement`), pas
`date_echeance` — seul l'argent réellement reçu compte, cohérent avec le
libellé "encaissés". Un paiement encore `impaye`/`partiel` non réglé ne
contribue que pour la part effectivement reçue (`montant_paye`), jamais le
montant dû.

**Limite préexistante du modèle, non introduite par ce module — à ne
jamais présenter comme une précision jour-par-jour fiable** : `paiements`
ne porte qu'**un seul** couple (`montant_paye`, `date_paiement`) par ligne
— un règlement en plusieurs versements sur des dates différentes n'est
**pas représentable tel quel**. Chaque appel à `PaiementsService.enregistrer()`
**écrase** la valeur précédente plutôt que de l'additionner : si un
versement de 400 € est enregistré le 5 puis un second de 400 € le 20 (pour
une échéance de 800 €), la ligne ne conserve que `date_paiement=20` avec
`montant_paye=800` — le graphique attribuerait les 800 € au 20, alors que
la moitié a réellement été perçue le 5. Corriger ce point nécessiterait une
table d'historique des versements, hors périmètre d'un module tableau de
bord (voir `docs/backlog.md`, dette technique).

## versements & remboursements — décisions de conception (chantier en cours)

Corrige la limite ci-dessus (versements multiples non représentables) et
modélise pour la première fois le remboursement (trop-perçu à la
résiliation, dépôt de garantie) — absent jusqu'ici. Décisions tranchées
avec l'utilisateur avant tout code :

- **`versements`** (nouvelle table, liée à `paiements`) : un `paiement`
  reste "ce qui est dû à une échéance", un `versement` devient "un
  encaissement réel" — plusieurs par paiement, y compris plusieurs le même
  jour. `montant_paye`/`mode`/`date_paiement`/`reference_rapprochement`
  quittent `paiements` pour `versements` ; `paiements.statut` reste, mais
  recalculé en sommant les versements actifs.
- **`remboursements`** (nouvelle table générique, liée à `baux` et
  optionnellement à `paiements`) : couvre à la fois le trop-perçu à la
  résiliation et le remboursement du dépôt de garantie via un champ
  `type`, plutôt que deux tables spécifiques. Jamais un `paiements.type`
  négatif — un remboursement inverse le sens du flux (propriétaire →
  locataire), une table à part rend cette direction structurellement
  impossible à confondre avec un encaissement.
- **Rapprochement CSV** (Module 5) : matche désormais sur le **solde
  restant** d'un paiement (montant dû − versements actifs), pas son
  montant total — un second versement partiel redevient proposable au
  rapprochement. Ambiguïté (une ligne CSV correspond par coïncidence à
  plusieurs critères de paiements différents) gérée par la règle déjà en
  place, inchangée : tous les candidats sont présentés, jamais de choix
  silencieux.
- **Annulation d'un versement** : `annulerVersement(versementId)` cible un
  versement précis (archivé directement sur la table `versements`, jamais
  une action groupée qui en archive plusieurs sans identification
  individuelle). Traçabilité déjà garantie par les colonnes d'audit du
  row lui-même (`updated_at`/`updated_by`/`version` sur ce `versement`
  précis) — `journal_audit` n'intervient pas ici : cette table est
  réservée aux événements d'**accès** à une donnée sensible (déchiffrement
  IBAN/BIC, action `acces`, voir `AuditService`), jamais à la trace
  générale des créations/modifications/archivages des tables métier.
- **Trop-perçu à la résiliation** : `resilier()` calcule et expose le
  trop-perçu (`somme des versements actifs − nouveau montant proratisé`,
  si positif), mais ne crée **jamais** de ligne `remboursements`
  automatiquement — cohérent avec la règle "jamais d'automatisation
  silencieuse" déjà appliquée au rapprochement et aux alertes. La création
  du remboursement reste un acte humain explicite.
- **Visibilité durable du trop-perçu, indépendante de tout archivage
  ultérieur** — même principe que le correctif Module 7 sur les
  revenus/le taux d'occupation (`docs/backlog.md`, "Les totaux
  SCI/immeuble n'excluent jamais un appartement archivé depuis") :
  l'indicateur "Remboursements en attente" (carte du tableau de bord,
  calculée à la volée plutôt que stockée comme une alerte du Module 6) ne
  filtre **jamais** par statut archivé de l'appartement, de l'immeuble ou
  du bail concerné. Un trop-perçu réel reste une obligation financière
  réelle même si le bien a été vendu, l'appartement archivé, ou le bail
  lui-même archivé après sa résiliation — l'archivage d'une entité ne doit
  jamais faire disparaître silencieusement une créance/dette financière
  qui la concerne. L'indicateur ne disparaît que lorsqu'un `remboursement`
  couvrant ce paiement existe réellement, jamais par effet de bord d'un
  archivage sans rapport.
- **Remboursements multiples sur un même dépôt de garantie** : autorisés
  (partiel maintenant, reste plus tard), validés à la création — rejet
  strict (`ConflictException`, sans exception) si
  `somme(montant_rembourse) > montant reçu`.
- **Migration en 3 phases (expand → migrate → contract)**, sans perte
  d'historique : (1) nouvelle migration Drizzle ajoutant `versements`/
  `remboursements` sans toucher aux colonnes existantes de `paiements` ;
  script de backfill (pas une migration générée) créant un `versement`
  par paiement déjà réglé (`montant_paye`→`montant`,
  `date_paiement`→`date_versement`, `mode`, `reference_rapprochement`
  repris tels quels), vérifié avant de continuer ; (2) bascule du code
  listé ci-dessus vers `versements`/`remboursements` ; (3) nouvelle
  migration supprimant `montant_paye`/`mode`/`date_paiement`/
  `reference_rapprochement` de `paiements` une fois plus aucun code ne
  les lisant/écrivant.

## alertes
| Champ | Type | Description |
|---|---|---|
| type | enum | `bail_fin_proche` \| `document_expire` \| `document_expire_proche` \| `entretien_equipement` \| `impaye` |
| entite_id | uuid | Id de la ligne concernée — la table cible se déduit de `type` (bail pour bail_fin_proche, paiement pour impaye, document pour document_expire(_proche), equipement pour entretien_equipement). Pas de FK possible (cibles différentes selon le type), même principe que `documents.entite_id` |
| statut | enum | `active` \| `traitee` \| `ignoree` \| `resolue` — voir cycle de vie ci-dessous |
| message | text | Résumé lisible, généré à la création de l'alerte |
| date_reference | date | Date métier à laquelle l'alerte se rapporte (`date_fin` du bail, `date_expiration` du document, prochaine date d'entretien calculée, ou `date_echeance` du paiement en retard) |
| derniere_condition_vraie | boolean | **Champ interne, jamais exposé à l'utilisateur** — voir ci-dessous |

**Cycle de vie complet (tranché avec l'utilisateur, prérequis du Module 6,
révisé après la revue financial-logic-reviewer qui a signalé le risque
d'"alerte impayé fantôme" — un paiement réglé après coup dont l'alerte
restait active indéfiniment)** :

- `active` : problème en cours, pas encore traité par l'utilisateur.
- `resolue` : le **job** a constaté que la condition déclenchante n'est
  plus vraie et a fermé l'alerte lui-même — distinct de `traitee`/`ignoree`
  (décisions humaines explicites), pour que le Module 7 puisse un jour
  distinguer "l'utilisateur a agi" de "le système a constaté que ce n'est
  plus un problème".
- `traitee` / `ignoree` : décision humaine, **définitive pour cette
  occurrence précise** — le job ne réécrit **jamais** ce statut.

**Réouverture (comportement volontairement différent selon le statut)** :
une alerte `resolue` peut se **rouvrir en place** (même ligne, repasse à
`active`) si la condition redevient vraie. Une alerte `traitee`/`ignoree`,
elle, ne se rouvre jamais — si la condition redevient vraie après avoir
été observée fausse, le job crée une **nouvelle ligne** (nouvelle
occurrence), sans jamais toucher à l'ancienne. Résultat : plusieurs lignes
peuvent exister dans le temps pour un même `(type, entite_id)` — l'index
unique ne porte donc que sur les lignes `active`
(`WHERE statut = 'active'`), jamais un unique permanent par entité.

**`derniere_condition_vraie` (champ interne)** : mémorise si la condition
déclenchante était vraie au dernier passage du job, y compris pour une
alerte `traitee`/`ignoree` dont le `statut`, lui, ne bouge jamais. Sert
uniquement à distinguer une condition restée vraie sans interruption
depuis le traitement (aucune action : sinon une alerte `bail_fin_proche`
déjà traitée, dont la condition reste vraie indéfiniment par construction,
se dupliquerait chaque jour) d'une vraie transition faux→vrai qui justifie
une nouvelle occurrence (ex. un paiement repassé `impaye` via
`PaiementsService.annulerEnregistrement()` après avoir été marqué payé).
Défaut `true` pour les lignes existantes lors de la migration d'ajout de
cette colonne — comportement sûr (aucune duplication intempestive au
premier passage suivant la migration).

## parametres_alertes
Une ligne par type d'alerte configurable, créée avec une valeur par défaut
au premier accès si absente (`AlertesConfigService`) — jamais par une
migration de données écrite à la main (CLAUDE.md).
| Champ | Type | Description |
|---|---|---|
| type | enum | Les 4 types configurables : `bail_fin_proche`, `document_expire_proche`, `entretien_equipement`, `impaye`. **`document_expire` n'a volontairement pas de ligne** : c'est un statut déjà calculé (`calculerStatutDocument`), pas une fenêtre d'anticipation — rien à configurer |
| seuil_jours_avant | integer | **Le sens dépend du type, tranché avec l'utilisateur** — voir ci-dessous |

**Décision produit (sens contextuel de `seuil_jours_avant`, tranchée avec
l'utilisateur)** : pour `bail_fin_proche`, `document_expire_proche` et
`entretien_equipement`, c'est un délai d'**anticipation avant** l'échéance
(ex. seuil=30 : l'alerte apparaît 30 jours avant `date_fin`/`date_expiration`/
la prochaine date d'entretien, et le reste indéfiniment tant que non
traitée). Pour `impaye`, la colonne change de sens : c'est un délai de
**grâce après** `date_echeance` (ex. seuil=5 : un loyer en retard n'est
signalé qu'à partir du 6e jour de retard, jamais le jour même de
l'échéance ni pendant le délai de grâce — même convention que
`calculerStatutDocument`, le dernier jour du délai est encore toléré).
Valeurs par défaut : 30 jours (bail_fin_proche, document_expire_proche,
entretien_equipement), 5 jours (impaye). **Un futur type d'alerte devra
préciser explicitement dans quel sens il utilise ce champ** — ne jamais
supposer "avant" par défaut.

## Tableau de bord (Module 7)

N'introduit aucune nouvelle table — uniquement des agrégations en lecture
sur les tables existantes. Décisions produit spécifiques à l'affichage,
tranchées avec l'utilisateur :

- **Carte "Documents expirés"** (jamais "Documents expirés/manquants") :
  n'affiche que les documents dont `calculerStatutDocument` renvoie
  `expire` — un champ déjà calculé, bien défini. "Manquants" impliquerait
  une checklist de catégories attendues par bail/appartement, absente du
  modèle actuel — voir `docs/backlog.md`, section Modules futurs, pour la
  checklist documentaire à concevoir séparément.
- **Carte "Échéances à venir"** : limitée aux paiements `impaye`/`partiel`
  dont `date_echeance` est **encore à venir** (`>= aujourd'hui`), séparation
  stricte avec la carte "Impayés" (`date_echeance < aujourd'hui`) — chaque
  échéance n'apparaît jamais dans les deux cartes à la fois. Comme le
  Module 6 ne génère jamais d'échéance à l'avance (seulement le mois
  courant), cette carte ne montre jamais qu'un rappel sur ce qui existe
  déjà en base pour le mois courant — jamais une projection des mois
  futurs qui n'existent pas encore.
- **En-tête** : "valeur locative des biens loués" = somme de
  `loyer_reference` (appartements) pour les appartements au statut `loue`
  uniquement — une estimation de référence, pas le loyer réellement
  contractualisé (`baux.loyer_mensuel` peut différer de `loyer_reference`,
  voir section `appartements`/`baux`).
- **Synthèse par SCI/immeuble/appartement** : "revenu total" est un revenu
  **brut** (loyer net, voir décision "Revenus locatifs" ci-dessus — jamais
  une "rentabilité nette", puisqu'aucune dépense n'est trackée dans le MVP
  actuel). Voir `docs/backlog.md`, dette technique, sur cette limite et le
  futur module qui la lèvera.
- **Les totaux SCI/immeuble n'excluent jamais un appartement archivé
  depuis** (corrigé après un premier écart identifié par
  financial-logic-reviewer, initialement documenté comme "divergence
  assumée" avant d'être reconnu comme une vraie erreur de calcul à
  corriger) : `getSynthese` (`apps/backend/src/tableau-de-bord`) n'applique
  **aucun** filtre `archived_at` sur `scis`/`immeubles`/`appartements` — le
  revenu perçu sur une période est un fait historique, jamais invalidé par
  un archivage survenu après coup (bien vendu, démoli, retiré du
  portefeuille). Sans cette règle, un appartement ayant perçu un loyer puis
  archivé disparaissait silencieusement de la ventilation SCI/immeuble tout
  en restant compté dans le total global "Revenus locatifs" — un écart de
  calcul, pas une différence de nature entre les deux écrans.
  Chaque niveau (SCI/immeuble/appartement) porte un champ `archive`
  (booléen) : le frontend l'utilise uniquement pour masquer par défaut la
  **ligne de détail** d'un appartement archivé (`ArchiveToggle`/
  `ArchiveBadge`, même convention que Patrimoine/Locataires/Finances) —
  masquer une ligne ne change **jamais** le total affiché au niveau
  immeuble ou SCI au-dessus. Testé explicitement
  (`tableau-de-bord.integration.spec.ts`, scénario "A102" : loyer perçu en
  juin, appartement archivé en juillet, tableau de bord consulté après
  coup — le graphique "Revenus locatifs" et la synthèse par immeuble
  affichent désormais exactement le même total pour juin).
- **Le taux d'occupation moyen d'un immeuble/SCI exclut un appartement
  archivé AVANT le début de la période interrogée** — nuance distincte de
  la règle sur le revenu ci-dessus, identifiée par financial-logic-reviewer
  lors de la revue du fix précédent : le revenu est une **somme** (un
  appartement hors périmètre y contribue naturellement 0 €, ce qui est
  correct), mais le taux d'occupation est une **moyenne divisée par un
  effectif**. Sans cette exclusion, un appartement archivé (vendu, démoli,
  retiré du portefeuille) continuerait à compter dans le dénominateur pour
  toute période future interrogée — où son occupation réelle est
  nécessairement 0 % puisqu'aucun bail ne peut plus s'y rattacher — tirant
  ainsi indéfiniment la moyenne de l'immeuble/SCI vers le bas alors que le
  bien n'appartient plus au parc à cette date. Concrètement :
  `appartement.archived_at` (converti en date, `YYYY-MM-DD`) comparé à
  `periodeDebut` ; si antérieur, l'appartement est retiré du dénominateur
  de la moyenne (immeuble et SCI) mais reste listé dans le détail par
  appartement (`archive: true`, `tauxOccupation: 0`) — seul l'agrégat
  change, jamais la liste. Un appartement archivé **pendant** la période
  (comme le scénario "A102" ci-dessus) reste inclus dans le dénominateur :
  son occupation réelle sur la partie de la période où il était encore
  actif est correctement calculée par `calculerJoursOccupes`, ce n'est que
  pour une période entièrement postérieure à l'archivage que l'exclusion
  s'applique. Testé explicitement (`tableau-de-bord.integration.spec.ts`) :
  un appartement témoin à 100 % d'occupation et un appartement archivé
  avant la période donnent un taux d'immeuble de 100 %, pas 50 %.

## Palette de commandes (Module 8)

Aucune nouvelle table : ce module est purement frontend, il réutilise les
endpoints de listing existants (`GET /scis`, `/immeubles`, `/appartements`,
`/locataires`, `/baux`, tous déjà capables de renvoyer la liste complète
sans filtre parent — `sciId`/`immeubleId` sont des query params optionnels
côté `ImmeublesController`/`AppartementsController`, inchangés).

- **Champs recherchés par entité** (vérifiés dans le schéma, pas supposés) :
  SCI → `nom` ; immeuble → `nom` **et** `adresse` (les deux existent) ;
  appartement → `numero` (il n'existe pas de champ `numero_lot` — libellé
  affiché avec le nom de l'immeuble parent pour désambiguïser deux
  appartements de même numéro dans des immeubles différents) ; locataire →
  `nom` + `prenom`. Les entités archivées (`statut === "archive"`) sont
  exclues de la recherche, comme partout ailleurs dans l'app.
- **Registre d'actions** volontairement limité à ce qui existe déjà :
  navigation vers les 6 écrans, plus deux actions contextuelles à
  recherche en 2 étapes ("Nouveau bail" cherche un appartement, "Nouveau
  paiement" cherche un bail actif/préavis — même filtre de statut que
  `NewPaiementForm`). Pas de "Nouvelle SCI"/"Nouveau locataire" autonomes :
  aucun des 5 parcours cibles de la Phase 6 (voir `docs/backlog.md`,
  Module 8) ne les requiert.
- **Contrat des query params de deep-link**, consommés au montage par les
  pages qui gèrent leur profondeur en état local (Patrimoine, Locataires —
  décision Phase 6/Module 2, jamais migrée en routes URL) :
  - `/patrimoine?sciId=...` / `?immeubleId=...` / `?appartementId=...`
    (le plus spécifique gagne) — `PatrimoinePage` résout la chaîne
    d'ancêtres manquante via `getAppartement`/`getImmeuble` avant
    d'initialiser son état de profondeur.
  - `/patrimoine?appartementId=...&nouveauBail=1` — ouvre en plus
    directement l'onglet "Bail actuel" avec le formulaire de création
    pré-ouvert (sans effet si un bail est déjà en cours : la fiche affiche
    alors simplement le bail actuel, comme d'habitude).
  - `/locataires?locataireId=...` — deep-link direct, pas de résolution
    d'ancêtres nécessaire (hiérarchie à un seul niveau).
  - `/finances?bailId=...` — filtre l'écran Finances sur ce bail
    uniquement (bandeau "Voir tous les paiements" pour lever le filtre) ;
    filtre purement d'affichage, ne modifie aucun total.
  Chaque page dépend de la représentation texte des query params
  (`searchParams.toString()`), jamais de l'objet `URLSearchParams` lui-même
  (recréé à chaque rendu) — même principe que le correctif du fil d'Ariane
  (`docs/error-log.md`, [2026-07-29]) : dépendre d'un objet recréé à chaque
  rendu quand seule sa valeur importe est la cause exacte de la boucle de
  rendu infinie corrigée ce jour-là.

## journal_audit
Table transverse, append-only — capture toute création/modification/archivage
sur n'importe quelle entité, ainsi que les événements de sécurité (connexions,
accès à un document sensible, exports). Ne porte pas les colonnes d'audit
standard (`updated_at`/`version`/`archived_at`) : une ligne de journal n'est
jamais modifiée après écriture.
| Champ | Type | Description |
|---|---|---|
| entite_type | text | Nom de la table concernée, ou `authentification` / `document_sensible` pour les événements de sécurité |
| entite_id | uuid, nullable | Identifiant de la ligne concernée ; nullable car certains événements de sécurité n'ont pas d'entité métier identifiable |
| action | enum | `creation` \| `modification` \| `archivage` \| `acces` — `acces` pour la consultation d'un document sensible (ex. déchiffrement d'IBAN/BIC, `GET /scis/:id/comptes-bancaires`) |
| donnees_avant / donnees_apres | jsonb | État avant/après, pour audit complet |
| utilisateur_id | uuid, nullable | Auteur de l'action ; nullable pour les événements non attribuables à un utilisateur résolu |
| created_at | timestamp | Horodatage de l'événement |

## utilisateurs
| Champ | Type | Description |
|---|---|---|
| organisation_id | uuid | Organisation de rattachement de l'utilisateur (modèle multi-tenant, app-spec §2) ; structurel — non lu par le flux d'authentification JWT actuel (`AuthService`), qui ne s'appuie que sur `email`/`mot_de_passe_hash`/`statut` |
| email | text, unique | Identifiant de connexion |
| nom / prenom | text | |
| mot_de_passe_hash | text | Argon2, jamais un autre algorithme |
| statut | enum | `actif` \| `archive` |

---

## Tables prévues mais non modélisées en détail (post-MVP)

Points d'ancrage déjà identifiés pour ne pas casser le schéma existant :
- `charges_annuelles` (liée à `baux` et `appartements`)
- `revisions_loyer` (liée à `baux`)
- `travaux` (liée à `appartements`)

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
| date_dernier_entretien | date | Sert de base au calcul d'alerte d'entretien |

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
    **Convention légale à valeur de prorata temporis, non négociable sans nouvelle décision** : `jours_occupes` compte les jours **du début du mois jusqu'à `date_fin` inclus** — le jour du départ est facturé en entier, pas exclu.
    Si cette échéance est déjà réglée intégralement (`statut=paye`) au moment de la résiliation, elle **n'est pas touchée automatiquement** — voir `docs/backlog.md`, dette technique, pour le cas du trop-perçu non traité.
  - **Cas B — aucune échéance ne couvre ce mois** : `resilier()` **génère la ligne manquante**, toujours proratisée **depuis le 1er jour** du mois de `date_fin` (jamais depuis `date_activation` ni `date_debut`) — règle sans ambiguïté : le mois de `date_debut` est **exclusivement** traité par le Cas A (l'échéance d'entrée, toujours générée pour ce mois précis dès l'activation, voir décision ci-dessus), donc tout mois que le Cas B doit encore combler est nécessairement postérieur, occupé en continu depuis son 1er jour. `date_echeance=date_fin`, statut `impaye` par défaut. Aucune ligne n'est créée si le montant proratisé est nul.
    **Portée volontairement limitée** : seul le mois de `date_fin` est comblé. Si plusieurs mois consécutifs n'ont jamais eu d'échéance générée (écart de plusieurs mois entre l'activation et la résiliation, en l'absence du job du Module 6), les mois intermédiaires restent non facturés — un rattrapage multi-mois n'est pas traité ici, c'est le rôle du Module 6 une fois construit (voir `docs/backlog.md`, prérequis de conception posé sur ce module).

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

## alertes
| Champ | Type | Description |
|---|---|---|
| type | enum | `bail_fin_proche` \| `document_expire` \| `document_expire_proche` \| `entretien_equipement` \| `impaye` |
| statut | enum | `active` \| `traitee` \| `ignoree` |
| seuil_jours_avant | integer | Configurable par type d'alerte dans Paramètres |

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

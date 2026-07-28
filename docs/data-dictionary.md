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
| jour_echeance | integer, nullable, 1-28 | Jour du mois auquel l'échéance de loyer tombe chaque mois. Borné à 28 pour rester valide sur tous les mois (pas de mois à 29/30/31 jours à gérer). Renseignable progressivement comme `loyer_mensuel`/`depot_garantie`, mais **obligatoire pour activer** un bail (`BauxService.activer()` refuse si `null` — impossible de générer la première échéance sans lui) |

**Décision produit (génération des échéances à l'activation, tranchée avec l'utilisateur)** :
- À l'activation d'un bail (`BauxService.activer()`), deux lignes de `paiements` sont générées dans la même transaction que le passage à `actif` :
  1. Dépôt de garantie, si `depot_garantie > 0` : `type=depot_garantie`, `montant=depot_garantie`, `date_echeance` = date d'activation (immédiate).
  2. Première échéance de loyer : `type=loyer`, `montant = loyer_mensuel + (provisions_charges ?? 0)`. Date : le jour courant est comparé à `jour_echeance` avec un **`≤`** (pas un `<`) — si le jour courant est encore inférieur ou égal à `jour_echeance`, l'échéance tombe dans le **mois en cours** ; sinon dans le mois suivant. Traiter l'égalité comme "pas encore passé" évite de faire sauter un mois entier d'obligation de loyer pile le jour de l'échéance.
  - Les échéances suivantes ne sont **jamais** générées d'avance : elles seront produites par le job planifié quotidien du Module 6 (moteur d'alertes, `docs/backlog.md`), qui n'existe pas encore au moment de cette décision.
- Le dépôt de garantie (`type=depot_garantie`) ne compte **jamais** comme un impayé au sens des futures alertes/indicateurs (Module 6/7) — seules les échéances `type=loyer` (et `charges`) sont concernées par cette notion.

**Décision produit (prorata à la résiliation, tranchée avec l'utilisateur)** :
- À la résiliation (`BauxService.resilier()`), l'échéance de loyer déjà générée dont `date_echeance` tombe dans le mois calendaire de `date_fin` est recalculée au prorata, **uniquement si son statut est encore `impaye` ou `partiel`** :
  `nouveau_montant = (loyer_mensuel + provisions_charges) × jours_occupes / jours_du_mois`, tronqué à deux décimales (jamais d'arrondi flottant, même convention que `montantEnCentimes`).
  **Convention légale à valeur de prorata temporis, non négociable sans nouvelle décision** : `jours_occupes` compte les jours **du début du mois jusqu'à `date_fin` inclus** — le jour du départ est facturé en entier, pas exclu.
- Si cette échéance est déjà réglée intégralement (`statut=paye`) au moment de la résiliation, elle **n'est pas touchée automatiquement** — voir `docs/backlog.md`, dette technique, pour le cas du trop-perçu non traité.

## bail_locataires
Table de liaison pour gérer la colocation.
| Champ | Type | Description |
|---|---|---|
| role | enum | `titulaire` \| `colocataire` |

## documents
| Champ | Type | Description |
|---|---|---|
| entite_type | enum | `sci` \| `immeuble` \| `appartement` \| `locataire` \| `bail` — lien polymorphe |
| categorie | enum | `bail` \| `assurance` \| `etat_des_lieux` \| `diagnostic` \| `dpe` \| `piece_identite` \| `rib` \| `caf` \| `quittance` \| `courrier` \| `photo` |
| statut | enum | `valide` \| `expire` \| `archive` |
| date_expiration | date, nullable | Alimente le moteur d'alertes |

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

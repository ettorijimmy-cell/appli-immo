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
| adresse, code_postal, ville | text, nullable | Siège social de la SCI. **Obligatoire à la création** (`CreateSciDto`) depuis l'introduction de cette règle — le propriétaire connaît ces informations dès la constitution de la SCI, contrairement à `telephone`/`est_familiale`. Le schéma reste nullable pour ne pas casser les fiches déjà créées sans ces champs (ex. GME) : celles-ci restent modifiables normalement via `UpdateSciDto` (champs optionnels), et `validerCompletudeGenerationBail` (packages/core) bloque proprement la génération du bail tant qu'un des trois est `null`, même principe que `est_familiale` ci-dessous |
| telephone | text, nullable | Mention "LE BAILLEUR" du modèle de bail, renseignable progressivement |
| est_familiale | boolean, nullable | Détermine la durée légale du bail vide (3 ans si vraie, 6 ans sinon — art. 10 loi n° 89-462). **Jamais de valeur par défaut**, y compris pour une nouvelle SCI créée après l'ajout de ce champ : rester `null` tant que non renseigné explicitement. La génération du bail doit bloquer avec un message clair si ce champ est `null` sur la SCI concernée, plutôt que de deviner une valeur (docs/backlog.md, section "Édition d'un bail") |
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
| annee_construction | integer, nullable | Détermine la tranche de construction du modèle de bail (packages/core, `calculerTrancheConstruction`). Colonne présente depuis la migration 0014 mais restée sans formulaire jusqu'ici — un oubli d'exposition, pas une question de conception : sans elle, le contrôle de complétude de la génération du bail bloquait systématiquement tout bail réel. Exposée via `UpdateImmeubleDto` et le formulaire immeuble (Module 2) |
| type_habitat | enum, nullable | `collectif` \| `individuel` — mention du contrat-type (décret n° 2015-587), pilote aussi les blocs conditionnels `{#collectif}`/`{#individuel}` du modèle Word. **Obligatoire à la création** (`CreateImmeubleDto`) : fait connu immédiatement par le propriétaire, contrairement à `annee_construction` qui reste facultatif. Schéma nullable pour ne pas casser les immeubles déjà créés ; modifiable ensuite via `UpdateImmeubleDto` (optionnel). Bloque la génération du bail si `null` (`validerCompletudeGenerationBail`) |
| regime_juridique | enum, nullable | `mono_propriete` \| `copropriete` — idem (obligatoire à la création, nullable en schéma, bloque la génération si `null`, pilote `{#copropriete}`/`{#monopropriete}`) |

## bien (migration bien, 2026-08-26)
Niveau générique introduit au-dessus d'appartement, remplaçant à terme
`immeubles` comme source de vérité pour la création/gestion du patrimoine
(`BienService`, route `/biens`) — voir docs/backlog.md. Un immeuble a N
appartements ; tout autre type (`maison`, `appartement_isole`, `parking`,
`bureau`, `local_commercial`) en a exactement 1 (règle applicative, pas une
contrainte de schéma). `immeubles` **n'est pas retiré** : conservé tel quel
tant que `documents.entite_type = 'immeuble'` en dépend pour les documents
déjà rattachés à une ligne existante — voir sort différé, section
"Modules à venir"/dette technique.
| Champ | Type | Description |
|---|---|---|
| type | enum | `immeuble` \| `maison` \| `appartement_isole` \| `parking` \| `bureau` \| `local_commercial` |
| proprietaire_type | enum | `sci` \| `personne_physique` — détermine la cohérence de `sci_id` (contrainte `bien_sci_id_coherent`) |
| sci_id | uuid, nullable | Informationnel/légal uniquement (fiscalité, futur module Charges et fiscalité — déclaration 2072) — **jamais** le mécanisme de scoping multi-tenant. `NULL` si `proprietaire_type = 'personne_physique'`, requis sinon |
| nom_proprietaire | text, nullable | Nom du bailleur en nom propre (Module Tâches, Étape 4 — quittance mensuelle, 2026-08-31). Symétrique de `sci_id` : requis si `proprietaire_type = 'personne_physique'`, `NULL` sinon (contrainte `bien_sci_id_coherent` actualisée pour couvrir les deux colonnes). Résolu vers un affichage unique par `BienService.resoudreNomBailleur(bienId)` — service partagé entre `bail-document-docx` et `quittance-document-docx`, aucun des deux ne doit résoudre cette logique lui-même. Corrige un bug latent découvert en auditant `bail-document-docx.service.ts` : avant ce correctif, la génération du document de bail levait `NotFoundException("SCI introuvable")` dès que `sci_id` était `NULL`, cas réel et valide depuis la migration Bien, pas seulement théorique. `calculerDureeBail` (packages/core) gagne à cette occasion un 3e régime `personne_physique` (bail vide, 3 ans automatique, aucun choix humain — contrairement au cas SCI où `sci_familiale`/`sci_non_familiale` reste toujours un choix humain, `estFamiliale` n'étant jamais déductible du schéma) |
| organisation_id | uuid | Clé de scoping multi-tenant réelle pour `bien`/`appartements` (Sync Streams PowerSync) — peuplée depuis l'organisation de l'utilisateur courant à la création (`BienService.create`, même mécanisme que `ScisService.create` pour `organisation_sci`), indépendamment du mode de détention. Un bien en nom propre (`proprietaire_type='personne_physique'`, `sci_id` NULL) n'aurait sinon aucun chemin de scoping : le chemin historique `organisation_sci -> sci_id -> immeuble` ne couvre que les biens en SCI |
| nom | text, nullable | Requis uniquement si `type = 'immeuble'` (contrainte `bien_nom_requis_si_immeuble`, vérifiée aussi côté `BienService.create` pour un message d'erreur clair). Repli d'affichage partout ailleurs (desktop, mobile-web) : `bien.nom ?? bien.adresse` |
| annee_construction | integer, nullable | Commun à tout type de bien vis-à-vis du contrat-type de bail — pas réservé aux immeubles (décision de l'audit du 2026-08-25, place ce champ sur `bien` plutôt que `bien_immeuble_detail`) |
| type_habitat | enum, nullable | `collectif` \| `individuel` — mention du contrat-type de bail (décret n° 2015-587). **Déplacé depuis `bien_immeuble_detail` le 2026-08-26** : caractérisation légale du LOGEMENT, jamais une donnée de gestion de copropriété (contrairement à `syndic`/`nb_lots`/`charges_copro_annuelles`, qui restent eux sur `bien_immeuble_detail`). Pour `type = 'maison'` : **dérivé automatiquement à `individuel`** par `BienService.create` (vrai par définition d'une maison individuelle), aucune saisie possible, jamais `NULL`, immuable ensuite (`BienService.update` rejette toute tentative de modification pour ce type). Pour tout autre type (`immeuble`, `appartement_isole`, `parking`, `bureau`, `local_commercial`) : saisie explicite requise à la création — ambigu par nature (un `appartement_isole` ou un `parking` peuvent être dans un ensemble collectif en copropriété, contrairement à une maison), `validerCompletudeGenerationBail` bloque la génération du bail si absent |
| regime_juridique | enum, nullable | `mono_propriete` \| `copropriete` — idem `type_habitat` ci-dessus en tout point (déplacement, dérivation automatique `mono_propriete` pour `maison`, obligation de saisie sinon) |
| date_acquisition, valeur_acquisition | date/decimal, nullable | Données d'acquisition — hors périmètre de la migration bien : assurance PNO explicitement exclue, différée au futur module "Suivi sinistre et assurance" |
| statut | enum | `actif` \| `archive` |

## bien_immeuble_detail (migration bien, 2026-08-26)
Extension 1:1 de `bien` pour le seul `type = 'immeuble'` — même pattern que
`diagnostics` (extension 1:1 de `documents`) : `id`/`auditColumns` propres,
pas `bien_id` en clé primaire. Justification : `syndic`/
`charges_copro_annuelles` changent dans le temps indépendamment du reste de
`bien` (changement de syndic, révision annuelle des charges) — sans audit
propre sur cette table, cette traçabilité serait perdue. `bien_id` est
`UNIQUE NOT NULL` (vraie relation 1:1, contrairement à `diagnostics.
document_id` qui n'a pas cette contrainte).
**`type_habitat`/`regime_juridique` déplacés vers `bien` le 2026-08-26**
(voir section `bien` ci-dessus) : ce sont des mentions légales du LOGEMENT,
pas des données de gestion de copropriété — cette table ne porte donc plus
que les champs réellement administratifs, sans équivalent pour un bien
non-immeuble.
| Champ | Type | Description |
|---|---|---|
| bien_id | uuid, unique | FK vers `bien.id`, `ON DELETE CASCADE` |
| syndic | text, nullable | Pas de mention contrat-type associée, informatif |
| nb_lots | integer, nullable | Idem |
| charges_copro_annuelles | decimal, nullable | Idem |

## appartements
| Champ | Type | Description |
|---|---|---|
| bien_id | uuid, nullable | FK vers `bien.id` — seule FK peuplée par `AppartementsService` depuis le 2026-08-26 (migration bien, Étape 4), y compris pour un appartement sous un bien de type `immeuble`. Nullable en schéma le temps de la transition (passage en `NOT NULL` différé, soumis à validation explicite une fois le frontend adapté) |
| immeuble_id | uuid, nullable | FK vers `immeubles.id` — **legacy**, rendue nullable le 2026-08-26 : un appartement sous un bien non-immeuble n'a et n'aura jamais de ligne `immeubles` correspondante. Plus jamais peuplée par `AppartementsService` sur une création postérieure à cette date (y compris pour un immeuble) ; conservée sur les lignes déjà existantes (backfillées depuis `immeubles`) — retrait de la colonne différé à une étape ultérieure explicitement validée |
| type | enum | `T1` \| `T2` \| `T3` \| `T4` \| `T5` \| `T6` — catégorie commerciale du lot, valeurs précises depuis le remplacement de `T5+` (aucun appartement réel en base n'utilisait cette valeur au moment du changement). **Distinct** de `nombre_pieces_principales` : le premier est une catégorie commerciale, le second le décompte légal de pièces — non redondants par conception, voir `packages/db/src/schema/appartements.ts` |
| statut | enum | `vacant` \| `loue` \| `travaux` \| `archive` |
| loyer_reference | decimal | Loyer de référence hors charges, utilisé pour pré-remplir un nouveau bail |
| equipement_cuisine | text, nullable | Mention du modèle de bail (cuisine équipée, bail meublé notamment) — texte libre |
| dependances_annexes | text, nullable | Mention du modèle de bail (cave, parking, balcon...) — texte libre |
| nombre_pieces_principales | integer, nullable | Décompte légal de pièces principales du modèle de bail — distinct de `type` (voir ci-dessus). **Obligatoire à la création** (`CreateAppartementDto`) : fait connu immédiatement par le propriétaire. Schéma nullable pour ne pas casser les lots déjà créés ; modifiable ensuite via `UpdateAppartementDto` (optionnel). Bloque la génération du bail si `null` (`validerCompletudeGenerationBail`). `deduireNombrePiecesDepuisType` (packages/core) pré-remplit ce champ dans le formulaire de création à partir du `type` choisi — une suggestion que le propriétaire confirme ou corrige, resynchronisée si `type` change tant que le champ n'a pas été modifié manuellement, jamais un repli silencieux côté validation/génération : la distinction type/décompte légal reste entière, seule la saisie initiale est facilitée |
| mode_chauffage | enum, nullable | `individuel` \| `collectif` — mention du contrat-type, pilote `{#chauffageIndividuel}`/`{#chauffageCollectif}`. Obligatoire à la création, même raisonnement que `nombre_pieces_principales`, bloque la génération si `null` |
| mode_eau_chaude | enum, nullable | `individuel` \| `collectif` — idem, pilote `{#eauChaudeIndividuelle}`/`{#eauChaudeCollective}` |
| type_energie | enum, nullable | `electrique` \| `gaz` \| `les_deux` — énergie du chauffage/eau chaude (module État des lieux, 2026-08-03). Confirmé au niveau du **lot**, pas de l'immeuble : peut varier d'un logement à l'autre même dans un immeuble à chauffage individuel — distinct de `mode_chauffage`/`mode_eau_chaude` ci-dessus, qui répond à une question différente (individuel/collectif) |
| nombre_chambres | integer, nullable | 0 à 3 (0 valide, ex. studio). Composition réelle du logement (module État des lieux, parcours mobile, 2026-08-07) — source de vérité unique pour générer le nombre d'étapes "Chambre N" du parcours mobile ET pour plafonner le nombre d'instances ajoutables dans la vue de relecture desktop, qui utilisait jusqu'alors le maximum du modèle réel codé en dur. Modifiable via `UpdateAppartementDto` uniquement (pas à la création). Bloque le **démarrage** d'un état des lieux si `null` (`validerCompletudeEtatDesLieux`, packages/core), même principe que `validerCompletudeGenerationBail` pour la génération du bail |
| nombre_salles_de_bain | integer, nullable | 0 à 2, même principe que `nombre_chambres` |
| nombre_wc | integer, nullable | 0 à 2, même principe que `nombre_chambres` |
| autre_piece_1, autre_piece_2 | text, nullable | Libellés fixes des 2 emplacements libres du modèle réel ("Autres pièces : ……") — **jamais saisis à la volée** depuis l'état des lieux (desktop ou mobile), contrairement aux chambres/SdB/WC : la vue de relecture et le parcours mobile lisent ces deux champs pour proposer les "autres pièces" à capturer. Si la disposition réelle change (mur abattu, pièce ajoutée), le propriétaire corrige la fiche appartement — aucun mécanisme de renommage rétroactif : chaque `etat_des_lieux_pieces_autre.libelle` garde la valeur telle que capturée au moment de la visite. Nullable, légitimement absents (0, 1 ou 2 autres pièces) — jamais requis par `validerCompletudeEtatDesLieux` |

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
| adresse, code_postal, ville | text, nullable | Identité du LOCATAIRE dans le modèle de bail, renseignables progressivement |
| date_naissance | date, nullable | Mention du modèle de bail |

## garants
| Champ | Type | Description |
|---|---|---|
| type_garantie | enum | `personne_physique` \| `garantie_visale` \| `autre` |
| date_naissance, lieu_naissance, nationalite | text/date, nullable | Mentions manuscrites de l'acte de cautionnement, sous peine de nullité absolue (loi ALUR) — figées à la création, même principe que adresse/profession/revenus |

## baux
Le passage du statut à `actif` (activation) et `resilie` (résiliation)
déclenche la transition automatique du statut de l'appartement associé
(`vacant` ↔ `loue`) — voir packages/core, `peutActiverBail` et
`calculerStatutAppartementApresResiliation`. Ces deux transitions sont les
seules voies pour changer `statut` : jamais via une mise à jour générique du
bail (`apps/backend/src/baux/baux.service.ts`, `UpdateBailDto` ne porte pas
ce champ).

**Concurrence (docs/backlog.md, dette technique Module 3, résolue)** :
index unique partiel Postgres `baux_appartement_id_actif_unique` sur
`(appartement_id) WHERE statut IN ('actif', 'preavis')` — garantit au
niveau base qu'un appartement n'a jamais plus d'un bail `actif`/`preavis`
simultané, même si deux appels concurrents à `activer()` passaient tous
les deux la pré-vérification applicative avant qu'aucun ne committe.
`activer()` traduit une violation de cet index en `ConflictException`
propre (`estViolationIndexBauxActifUnique`) plutôt que de laisser remonter
l'erreur SQL brute. `AppartementsService.update()` applique la même
logique côté appartement : `statut: 'loue'` est rejeté (`ConflictException`)
si aucun bail `actif`/`preavis` n'existe réellement — la correction
légitime d'une désynchronisation existante reste possible, seule
l'existence du bail compte, jamais le chemin par lequel il y est arrivé.
| Champ | Type | Description |
|---|---|---|
| type_bail | enum | `vide` \| `meuble` |
| statut | enum | `brouillon` \| `actif` \| `preavis` \| `resilie` \| `archive` |
| loyer_mensuel | decimal, nullable | Loyer **hors charges** (HC) — pré-rempli depuis `appartements.loyer_reference` à la création si non saisi explicitement (packages/core, `preremplirLoyerBail`) ; reste modifiable ensuite |
| depot_garantie | decimal, nullable | |
| provisions_charges | decimal, nullable | Provisions mensuelles pour charges, en plus du loyer HC. `null` traité comme `0` dans tout calcul (jamais de distinction "pas de charges" vs "charges non renseignées" au niveau calcul, seulement au niveau saisie) |
| jour_echeance | integer, nullable, 1-28 | Jour du mois auquel une échéance de loyer **récurrente** (2e mois et suivants) tombera, une fois le job du Module 6 construit. **N'a aucun effet sur la première échéance** (ni son montant, ni sa date d'exigibilité — voir décision ci-dessous) : c'est précisément la confusion qui causait le bug d'origine (échéance d'entrée calculée sur le jour d'activation au lieu de `date_debut`). Borné à 28 pour rester valide sur tous les mois. Renseignable progressivement comme `loyer_mensuel`/`depot_garantie`, mais **obligatoire pour activer** un bail (`BauxService.activer()` refuse si `null`) — uniquement pour ne jamais activer un bail qui ne pourrait plus jamais être facturé une fois le Module 6 construit, pas pour la première échéance elle-même |
| date_signature | date, nullable | Date de signature du bail, distincte de `date_debut` (un bail est souvent signé plusieurs semaines avant sa prise d'effet). Modifiable via `CreateBailDto`/`UpdateBailDto`, contrairement à `date_activation`/`date_resiliation`. Sert de référence pour déterminer le régime de clause résolutoire applicable (décret n° 2026-596, la loi parle de contrats "conclus" à telle date) et pour la mention "Fait à..., le" du document généré — **repli documenté sur `date_debut`** tant qu'elle n'est pas renseignée (baux créés avant l'introduction de ce champ, migration 0018, ou simplement pas encore saisie) |
| date_activation | date, nullable | Posée une seule fois par `BauxService.activer()`, jamais modifiée ensuite (absente d'`UpdateBailDto`). Trace historique du moment administratif de l'activation — **n'entre plus dans aucun calcul financier** (ni la première échéance, ni la résiliation, voir décisions ci-dessous). `null` pour les baux passés à `actif` avant l'introduction de cette colonne (migration 0007, sans backfill) |
| date_resiliation | timestamp with time zone, nullable | Posée une seule fois par `BauxService.resilier()`, jamais modifiée ensuite (absente d'`UpdateBailDto`) — même principe d'immutabilité que `date_activation`. **N'entre dans aucun calcul financier** : sert uniquement au frontend (`BailActuelTab`) pour identifier, parmi **plusieurs baux résiliés sur un même appartement** (historique de locataires successifs), celui qui vient d'être résilié à l'instant, afin d'y donner accès au dépôt de garantie et aux remboursements (section "versements & remboursements" ci-dessous). Timestamp (pas une simple date) : contrairement à `date_fin` (date métier de fin d'occupation), qui peut coïncider entre deux baux différents et ne départage donc pas de façon fiable, `date_resiliation` est toujours strictement croissante d'une résiliation à l'autre. `null` pour les baux résiliés avant l'introduction de cette colonne (migration 0013, sans backfill) — **repli explicite sur `updated_at` pour ces seuls cas legacy**, jamais la méthode de tri normale (bug réel constaté : sans tri du tout, un ordre de scan SQL non garanti pouvait faire apparaître le bail résilié d'un ancien locataire à la place de celui qu'on venait de résilier) |
| travaux_realises | text, nullable | Mention obligatoire du contrat-type ("travaux effectués depuis le dernier bail") — texte libre par nature, aucun vocabulaire fermé possible côté décret. Modifiable via `UpdateBailDto`, contrairement à `date_activation`/`date_resiliation` (docs/backlog.md, section "Édition d'un bail") |
| honoraires_bailleur, honoraires_locataire | decimal, nullable (les deux) | Section IX du contrat-type ("Honoraires de location"). Rattachés au bail, pas à la SCI/organisation : un même bailleur peut ou non recourir à un professionnel selon la location. Les deux `null` → section affichée "néant" dans le document généré. Sans objet dans l'usage actuel (particulier/SCI gérant en direct), prêt sans changement de code le jour où un professionnel intervient |
| trimestre_reference_revision | integer, nullable, 1-4 | Trimestre IRL de référence de la clause d'indexation (Module Tâches, Étape 5, 2026-08-30) — propre à chaque contrat, **non déductible automatiquement de façon fiable**, jamais deviné en silence : `null` tant que non renseigné explicitement, aucune révision de loyer générée pour ce bail dans ce cas. `CHECK` en base (`baux_trimestre_reference_revision_valide`) en plus de la validation applicative |

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

**Unicité du titulaire (2026-08-31, Module Tâches — extension notifications)** :
index unique partiel `bail_locataires_bail_id_titulaire_actif_unique` sur
`(bail_id) WHERE role = 'titulaire' AND archived_at IS NULL` — au plus un
titulaire non archivé à la fois par bail, quel que soit son statut. Non
scopé par statut de bail (contrairement à `baux_appartement_id_actif_unique`) :
un index partiel ne peut référencer que les colonnes de sa propre table, et
il n'y a de toute façon aucune raison légitime qu'un bail ait plus d'un
titulaire actif, quel que soit son statut. Audit de données réalisé avant
l'ajout (2026-08-31) : zéro bail actif/préavis sur Scaleway au moment de
l'ajout, aucun risque de violation par une donnée réelle. Le cas **zéro
titulaire** (bail avec uniquement des `colocataire`) reste possible et
volontairement non contraint — la résolution du titulaire pour une
notification (`TachesJobService`) doit le gérer explicitement (retourne
`null`, jamais une erreur), voir section tâches ci-dessus.

## documents
| Champ | Type | Description |
|---|---|---|
| entite_type | enum | `sci` \| `immeuble` \| `bien` \| `appartement` \| `locataire` \| `bail` \| `etat_des_lieux` \| `garant` — lien polymorphe. Pas de contrainte de clé étrangère possible (8 tables cibles) : `DocumentsService.verifierEntiteExiste()` vérifie applicativement que `entite_id` existe bien dans la table correspondant à `entite_type` avant d'insérer. `etat_des_lieux` ajouté pour les photos prises pendant la saisie numérique (module État des lieux, 2026-08-03). `garant` ajouté le 2026-08-24 (checklist documentaire, pièce d'identité du garant). `bien` ajouté le 2026-08-26 (migration bien) : seul chemin possible pour rattacher un document à un bien non-immeuble (maison, parking, bureau, local_commercial) ou à un immeuble créé après cette date via `BienService` — `immeuble` reste réservé aux documents déjà rattachés à une ligne `immeubles` existante (table conservée, voir section `bien` ci-dessous) |
| entite_id | uuid | Voir `entite_type` ci-dessus |
| categorie | enum | `bail` \| `assurance` \| `etat_des_lieux` \| `diagnostic` \| `dpe` \| `elec_gaz` \| `crep_plomb` \| `erp` \| `piece_identite` \| `rib` \| `caf` \| `quittance` \| `courrier` \| `photo` — `diagnostic` reste le seau générique pour tout diagnostic non encore distingué (ex. amiante, hors périmètre à ce jour) ; `dpe`/`elec_gaz`/`crep_plomb`/`erp` existent en valeurs dédiées uniquement pour permettre à `BailDocumentDocxService` de détecter leur présence en pièce annexée — aucun résultat structuré stocké ici (voir table `diagnostics`, 1:1 avec `documents`, encore non reliée à aucun module/UI à ce jour) |
| statut | enum | `valide` \| `expire` \| `archive` — voir décision produit ci-dessous : `archive` seul est réellement écrit en base, `valide`/`expire` sont calculés à la lecture |
| date_expiration | date, nullable | Alimente le moteur d'alertes (Module 6) et le calcul de `statut` |
| nom_fichier | text | Nom original du fichier, affiché et utilisé pour la recherche plein texte de l'écran Documents |
| mime_type | text | Type MIME déclaré à l'upload, renvoyé tel quel au téléchargement (`Content-Type`) |
| taille_octets | integer | Taille du fichier original (avant chiffrement) |
| chemin_stockage | text | Clé/chemin du blob chiffré sur le stockage configuré (voir décision ci-dessous) — `documents/<entite_type>/<entite_id>/<id>.enc`, interne à `DocumentsService`/`DocumentStorageService` |
| etat_des_lieux_piece_type | enum, nullable | `entree` \| `sejour` \| `cuisine` \| `chambre` \| `salle_de_bain` \| `wc` \| `autre` — significatif uniquement quand `entite_type = 'etat_des_lieux'` (photos prises depuis le parcours mobile pas-à-pas, un bouton "+ Photo" par pièce). Ajouté le 2026-08-07 : corrige un trou identifié en test manuel (photo visible dans Documents mais pas rattachée à sa pièce en relecture desktop) |
| etat_des_lieux_piece_numero | integer, nullable | Numéro d'instance pour chambre/salle_de_bain/wc/autre (null pour entrée/séjour/cuisine, pièces à instance unique) |

**Rattachement des photos à une pièce précise (2026-08-07)** : `entite_id`
pour une photo d'état des lieux reste l'id de l'en-tête `etats_des_lieux`
(jamais celui d'une ligne de pièce) — les lignes de pièce
(`etat_des_lieux_pieces_chambre` etc.) sont créées paresseusement par
upsert-by-id seulement à la soumission de l'étape mobile correspondante
("Suivant"), potentiellement APRÈS que la photo ait été prise (le bouton
"+ Photo" envoie immédiatement, indépendamment du cycle de soumission de
l'étape — voir docs/backlog.md, section État des lieux). Utiliser l'id
d'une ligne de pièce comme `entite_id` ne serait donc pas fiable : cette
ligne peut ne pas encore exister. `etat_des_lieux_piece_type`/`_numero`
identifient la pièce par sa position dans le parcours (déterministe dès
l'étape mobile, indépendante de l'existence de la ligne), pas par clé
étrangère — la relecture desktop les associe à la ligne réelle par
correspondance `(type, numero)`, dans n'importe quel ordre de création.
Garde-fou applicatif (`DocumentsService.upload`) : ces deux champs sont
rejetés (400) si `entite_type` n'est pas `etat_des_lieux`.

**Décision produit (stockage, tranchée avec l'utilisateur, 2026-08-09)** :
deux backends selon la présence de `OBJECT_STORAGE_ACCESS_KEY`/
`OBJECT_STORAGE_SECRET_KEY`/`OBJECT_STORAGE_BUCKET_NAME`
(`DocumentStorageService`, `apps/backend/src/documents/storage`) — même
bascule que `DATABASE_URL` entre Postgres local et Scaleway (nommage sans
préfixe `SCW_`, réservé par la plateforme — voir docs/error-log.md,
[2026-08-11]) :
- **absentes → disque local** (dev par défaut, comportement historique) :
  dossier configurable `DOCUMENTS_STORAGE_DIR` (repli par défaut
  `storage/documents` relatif au dossier `apps/backend` — voir
  `.env.example`) ;
- **présentes → Scaleway Object Storage** (S3-compatible, région fr-par
  fixe, bucket chiffré SSE-ONE — voir docs/integrations.md).

Dans les deux cas, chaque document est chiffré (AES-256-GCM,
`EncryptionService.encryptBuffer` — `apps/backend/src/crypto`, mêmes
clé/algorithme que l'IBAN/BIC) **avant** d'être écrit, sous la même clé/
chemin : `documents/<entite_type>/<entite_id>/<id>.enc` (organisé par
entité plutôt qu'un préfixe plat, cohérent avec le lien polymorphe —
`construireCheminStockage`, `apps/backend/src/documents/storage`). Seuls
des UUID apparaissent dans ce chemin — jamais le nom de fichier original
(`documents.nom_fichier`), qui reste uniquement en base. L'id de la ligne
`documents` est généré côté application (`uuidv7()`, avant l'insertion) et
non par le défaut du schéma, car il doit être connu pour construire le
chemin avant l'écriture du blob.

Le contenu en clair n'est accessible que via `GET /documents/:id/contenu`,
route authentifiée qui journalise l'accès dans `journal_audit`
(`AuditService.logAccesDocumentSensible`, même mécanisme que l'IBAN/BIC),
jamais via une URL publique ou un chemin de fichier exposé au frontend
(CLAUDE.md, section Règles importantes).

**Exception délibérée — fichiers de référence (2026-08-24)** : les
fichiers fixes, publics, partagés par toute l'app et non rattachés à une
entité (ex. la notice d'information légale annexée au bail, arrêté du
29 mai 2015) vivent sous le préfixe `references/` (pas
`documents/<entite_type>/...`), **jamais chiffrés** (aucune donnée
utilisateur — chiffrer un texte légal public serait un contre-sens) et
sans ligne `documents` associée (aucun `entite_type` ne représente
"aucune entité"). Nouveau module `apps/backend/src/references`
(`ReferencesService`/`ReferencesController`, route `GET
/references/:slug`) — réutilise `DocumentStorageService` en instance
séparée (`chiffrer: false` sur `enregistrer`/`lire`), jamais
`DocumentsModule` en entier, qui dépendrait alors inutilement de
Postgres. Script réutilisable `pnpm --filter backend
upload:notice-information` pour déposer/mettre à jour ces fichiers.

**Décision produit (`ENCRYPTION_KEY` dev/prod, tranchée avec l'utilisateur,
2026-08-11)** : la clé de production (Scaleway Serverless Containers) est
générée indépendamment de celle utilisée en développement local — jamais
la même valeur, jamais copiée de l'une vers l'autre. Cohérent avec la
séparation dev/prod déjà en place pour `DATABASE_URL`
(`DEFAULT_DEV_DATABASE_URL` vs base Scaleway). Décision possible sans
contrainte de migration : au moment de la génération de la clé de
production, aucune donnée réelle n'était encore chiffrée sur la base
Scaleway (seul le schéma avait été migré — voir docs/backlog.md,
Hébergement backend) ; rien ne dépendait donc de la clé de dev côté
production. Si des données de dev doivent un jour être reprises en
production, elles devront être déchiffrées avec la clé de dev puis
rechiffrées avec la clé de prod — jamais migrées telles quelles.

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

**Versioning des documents (dette technique résolue)** : `document_precedent_id`
(auto-référence nullable vers `documents.id`) chaîne un nouvel upload à la
version qu'il remplace. `DocumentsService.remplacerDocument()` crée la
nouvelle ligne puis archive l'ancienne (`archived_at` posé, `statut =
archive`) dans la même transaction — jamais de suppression physique, jamais
deux versions `valide` simultanées dans une même chaîne. La version courante
d'une chaîne est celle qu'aucune autre ligne ne référence via
`document_precedent_id`. Seule la version courante (non archivée) peut être
remplacée : `remplacerDocument()` rejette (409) toute tentative sur une
ligne déjà archivée, qu'elle le soit via un remplacement précédent ou via
`archiver()` manuel — un nouvel upload sans lien de version reste toujours
possible via `DocumentsService.upload()`, y compris pour une entité qui a
déjà un document archivé. Endpoint dédié `POST /documents/:id/remplacer`
(multipart, même mécanique que `POST /documents`), distinct de l'upload
simple plutôt qu'un flag conditionnel sur celui-ci. Affichage d'un
historique de versions côté desktop : hors périmètre de ce chantier (sujet
UX futur).

## paiements
Rattaché à un bail (`baux`, Module 3). `montant` est la somme attendue à
l'échéance. Depuis le chantier "versements & remboursements" (voir
section dédiée ci-dessous), `paiements` ne porte plus lui-même ce qui a
été effectivement réglé — `mode`/`montant_paye`/`date_paiement`/
`reference_rapprochement` ont été retirés à la Phase 3 (contract) de ce
chantier, remplacés par la table `versements` (un ou plusieurs
encaissements réels par paiement). `statut` reste calculé, jamais saisi
directement (packages/core, `calculerStatutPaiement`), mais désormais
depuis la somme des versements actifs (`calculerMontantRecuTotal`) : `impaye`
si aucun versement actif, `paye` si la somme couvre `montant`, `partiel`
sinon.
| Champ | Type | Description |
|---|---|---|
| type | enum | `loyer` \| `charges` \| `depot_garantie` |
| statut | enum | `paye` \| `impaye` \| `partiel` |
| montant | decimal | Somme attendue à l'échéance |
| date_echeance | date | |
| loyer_hors_charges | decimal, nullable | **Module Tâches, Étape 4 — quittance mensuelle, 2026-08-31.** Décomposition FIGÉE au moment de la génération de l'échéance (`AlertesJobService.genererEcheancesRecurrentes`, copie directe de `baux.loyer_mensuel`), **jamais recalculée** ensuite même si le bail est révisé — décision produit explicite, tranchée avec l'utilisateur, volontairement différente de l'ESTIMATION `calculerProvisionsRecuesEcheance`/`calculerLoyerNetRecuEcheance` décrite juste au-dessus (celles-ci restent inchangées, utilisées uniquement par l'agrégation du tableau de bord Module 7). Nullable : compatibilité avec les échéances déjà existantes avant l'ajout de cette colonne, jamais rétro-remplies. Sert de garde-fou bloquant pour `QuittanceDocumentDocxService` (`validerCompletudeGenerationQuittance`, packages/core) : une échéance antérieure à cette date n'est pas éligible à la génération de quittance tant qu'elle n'est pas figée. **Invalidé (repassé à `NULL`) par `PaiementsService.update()`** dès que `montant` change sur une échéance déjà figée (revue financial-logic-reviewer, 2026-08-31) : sans ce garde-fou, une correction légitime de `montant` (typo, ajustement) laisserait `loyer_hors_charges`/`charges` PÉRIMÉS, et une quittance générée ensuite afficherait un montant faux plutôt que de bloquer explicitement |
| charges | decimal, nullable | Symétrique de `loyer_hors_charges` ci-dessus (copie de `baux.provisions_charges`, figée, jamais recalculée). Vaut `'0.00'` (jamais `NULL`) quand le bail n'a pas de provisions pour charges, pour qu'une quittance affiche explicitement zéro plutôt qu'un champ vide ambigu — `NULL` signifie uniquement "cette colonne n'existait pas encore lors de la génération de cette échéance", jamais "pas de charges" |

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
l'utilisateur)** : `montant` ne distingue **jamais** loyer et
provisions_charges pour une échéance `type=loyer` — une seule colonne,
les deux parts y sont fondues dès la génération (`calculerMontantEcheanceLoyer`).
Le montant de provisions réellement perçu est donc une **estimation
dérivée**, jamais une valeur stockée, calculée par
`calculerProvisionsRecuesEcheance` (packages/core) :
`provisions_reçues = montant_reçu × (provisions_charges / (loyer_mensuel + provisions_charges))`,
appliquée à `montant_reçu` (somme des versements actifs de l'échéance,
`calculerMontantRecuTotal`) pour chaque paiement `type=loyer` de la
période. Cette formule
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

Base de calcul : **date de versement réelle** (`versements.date_versement`,
une ligne par encaissement — voir section ci-dessous), pas `date_echeance`
— seul l'argent réellement reçu compte, cohérent avec le libellé
"encaissés". Un paiement encore `impaye`/`partiel` non réglé ne contribue
que pour la part effectivement reçue, jamais le montant dû. Un règlement en
plusieurs versements sur des dates différentes (ex. 400 € le 5, 400 € le
20 pour une échéance de 800 €) est représenté correctement : chaque
versement est attribué au mois de sa **propre** date, contrairement à la
limite qui existait avant ce chantier (voir ci-dessous) où `paiements` ne
portait qu'un seul couple montant/date par ligne.

## versements & remboursements — décisions de conception (chantier terminé)

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
- **Migration en 3 phases (expand → migrate → contract), sans perte
  d'historique — les 3 terminées** : (1) migration Drizzle ajoutant
  `versements`/`remboursements` sans toucher aux colonnes existantes de
  `paiements` ; script de backfill (pas une migration générée, usage
  unique et non rejouable — supprimé à la Phase 3, sans utilité une fois
  les colonnes qu'il lisait disparues) créant un `versement` par paiement
  déjà réglé (`montant_paye`→`montant`, `date_paiement`→`date_versement`,
  `mode`, `reference_rapprochement` repris tels quels), vérifié avant de
  continuer ; (2) bascule du code listé ci-dessus vers
  `versements`/`remboursements` ; (3) migration supprimant
  `montant_paye`/`mode`/`date_paiement`/`reference_rapprochement` de
  `paiements`, après recherche exhaustive confirmant plus aucune lecture
  ni écriture de ces colonnes nulle part dans le code.

**Non-régression confirmée à la clôture du chantier (Module 5 et Module 7,
pas seulement les nouveaux tests versements/remboursements)** : nombre de
tests d'intégration backend, par fichier, comparé entre le commit
`14a2b8d` (dernier commit avant l'ouverture de ce chantier) et l'état
après la Phase 3 — aucun fichier n'a perdu de test, tous ont soit
maintenu leur nombre soit grandi :

| Fichier | Avant | Après |
|---|---|---|
| alertes.integration.spec.ts | 12 | 12 |
| auth.integration.spec.ts | 4 | 4 |
| baux/locataires-baux.integration.spec.ts (Module 3, proration Module 5) | 26 | 30 |
| documents.integration.spec.ts | 7 | 7 |
| immeubles/patrimoine.integration.spec.ts (Module 2) | 6 | 7 |
| paiements.integration.spec.ts (Module 5) | 10 | 12 |
| remboursements.integration.spec.ts (nouveau) | — | 6 |
| scis.integration.spec.ts | 5 | 5 |
| tableau-de-bord.integration.spec.ts (Module 7) | 12 | 16 |
| **Total** | **82** | **99** |

packages/core : 183 tests, tous passants après la Phase 3 (renommage du
paramètre `montantPaye`→`montantRecu` de `calculerStatutPaiement` sans
impact sur les tests, positionnels).

### Motif de retenue dépôt de garantie (2026-08-24)

Complète la dette technique identifiée ci-dessus (`remboursements.commentaire`
texte libre jugé insuffisant, `docs/backlog.md`) : ajoute un motif structuré
et une pièce jointe chiffrée, sans nouveau chantier de conception séparé —
décisions tranchées avec l'utilisateur avant tout code.

- **`remboursements.motif_retenue`** (nouvel enum `remboursement_motif_retenue`,
  nullable) : `degradation_locative` \| `reparations_locatives_non_effectuees`
  \| `charges_impayees` \| `loyers_impayes` \| `autre`. Catégories issues de la
  pratique/jurisprudence, pas de la loi n° 89-462 elle-même — l'art. 22 impose
  seulement que toute retenue soit "dûment justifiée", sans nomenclature.
  "Ménage non fait" volontairement fondu dans
  `reparations_locatives_non_effectuees` (même fondement juridique : entretien
  courant à la charge du locataire, pas une dégradation) plutôt qu'une valeur
  séparée.
- **Pièce jointe : 4 colonnes dédiées sur `remboursements`**
  (`piece_justificative_chemin/nom_fichier/mime_type/taille_octets`), pas une
  7e cible sur le lien polymorphe `documents`. Choix délibéré : relation 1:1
  stricte (un seul justificatif par remboursement, pas de système de motifs
  multiples pour l'instant), aucun cycle de vie expiration/versioning à gérer
  ici contrairement à `documents` — la 7e cible aurait forcé à faire cohabiter
  deux sémantiques différentes (entité patrimoniale vs. transaction
  financière) dans le même enum `document_entite_type`.
  `piece_justificative_chemin` suit exactement les mêmes règles que
  `documents.chemin_stockage` : chiffré (`DocumentStorageService.enregistrer`,
  `{ chiffrer: true }` — donnée personnelle, contrairement à l'exception
  `ReferencesService`), jamais exposé au frontend (projection explicite dans
  `RemboursementsService.versDto`), jamais dans le Sync Stream PowerSync.
- **Règle de complétude, appliquée dans `RemboursementsService.create()`** :
  motif et pièce jointe sont exigés **ensemble**, uniquement quand
  `type = depot_garantie` ET `montant_rembourse < montant_origine` (retenue
  réelle) — rejet strict (`BadRequestException`) si l'un manque dans ce cas,
  ou si l'un des deux est fourni hors de ce cas (remboursement intégral,
  trop-perçu). Un remboursement partiel du dépôt est toujours une retenue au
  sens de la loi, même s'il s'agit d'un versement échelonné négocié — aucune
  exception à cette règle.
- **Endpoint combiné** : `POST /remboursements` accepte un corps multipart
  (`FileInterceptor("pieceJustificative")`), même pattern que
  `DocumentsController.upload()`, fichier optionnel (contrairement à
  `documents`, la plupart des remboursements n'en ont pas). Téléchargement via
  `GET /remboursements/:id/piece-justificative`, avec le même mécanisme
  d'audit que `documents.telecharger()` (`AuditService.logAccesDonneeSensible`,
  `entiteType: "remboursement_piece_justificative"`).

### Checklist documentaire (2026-08-24)

Complète la carte "Documents expirés" ci-dessus — voir aussi
`docs/backlog.md`, section Modules futurs, pour l'historique de la
décision de la traiter séparément. `TableauDeBordService.getChecklistDocumentaire()`,
calculée à la volée (même philosophie que "Remboursements en attente" :
volume négligeable à l'échelle de l'app, ~20 logements, CLAUDE.md).
Portée simple, sans distinction obligatoire/recommandé, tranchée avec
l'utilisateur avant tout code :

- **Par appartement (non archivé)** : DPE, élec/gaz, CREP, ERP —
  document `statut='valide'` (calculé via `calculerStatutDocument`,
  expiration comprise) rattaché à l'appartement OU à son bien parent
  (migration bien, 2026-08-26 : `appartement.immeuble_id` **et**
  `appartement.bien_id` sont vérifiés en parallèle — un appartement
  backfillé a les deux, un appartement créé après cette date n'a plus que
  `bien_id` — jamais l'un à la place de l'autre, sous peine de perdre la
  couverture des diagnostics déjà rattachés à une ligne `immeubles`
  existante), même logique de détection que `BailDocumentDocxService`. Un
  diagnostic expiré compte comme **manquant** ici (contrairement à
  l'annexe d'un bail déjà signé, qui ne regarde que l'archivage) — deux
  besoins différents, pas une incohérence à corriger.
- **Par locataire actif** (rattaché via `bail_locataires` non archivé à
  un bail `statut IN ('actif', 'preavis')`, jamais les locataires
  historiques) : pièce d'identité.
- **Par garant actif** (`bailId` pointant vers un bail
  `statut IN ('actif', 'preavis')`, garant lui-même non archivé) : pièce
  d'identité.

Ne renvoie que les entités avec au moins un document manquant, jamais un
état exhaustif — même convention que "Remboursements en attente".

**Blocage découvert en implémentant le volet garant** : `documents.entite_type`
ne comportait que 6 valeurs (sci, immeuble, appartement, locataire, bail,
etat_des_lieux) — aucun moyen d'attacher un document à un garant.
Résolu en ajoutant `garant` comme 7e cible du lien polymorphe existant
(même mécanisme que locataire/bail, décision reprise avec l'utilisateur
plutôt que travaillée en silence) : migration Drizzle,
`DocumentsService.verifierEntiteExiste()` étendu, `documentEntiteTypeEnum`
mis à jour, et la 7e branche ajoutée aux 4 requêtes du Sync Stream
PowerSync qui filtrent par `documents.entite_type`
(`docs/powersync-sync-streams.yaml` : streams `documents`, `diagnostics`,
et les deux branches `document_expire`/`document_expire_proche` du
stream `alertes`).

**Gap connu, non traité dans ce chantier** : aucune interface desktop
n'existe encore pour attacher un document à un garant (contrairement à
locataire/appartement, qui ont déjà `DocumentsForEntite`) — la checklist
signalera donc les garants comme "manquants" sans qu'un utilisateur
puisse actuellement corriger ça depuis l'écran Garants. À traiter avec
le pendant desktop de la checklist.

**`locataires.lieu_naissance`** (colonne ajoutée dans le même chantier) :
même besoin que `garants.lieu_naissance`, absent jusqu'ici côté
locataires — déclaration fiscale annuelle du bailleur, date + lieu de
naissance du locataire requis.

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

## tache (Module Tâches, Étape 1, 2026-08-28)
Alertes et Tâches sont deux concepts distincts, pas un seul dédoublé.
**Alertes** = détection passive d'une condition (le document est expiré, le
loyer n'est pas payé) — inchangé, voir section `alertes` ci-dessus.
**Tâches** = gestion de l'action à mener suite à ce constat, avec un cycle de
vie propre (`a_faire`/`en_cours`/`fait`/`annulee`), volontairement distinct
de celui d'`alertes` (`active`/`traitee`/`ignoree`/`resolue`) — pas de
réutilisation de la state machine `synchroniserAlerte`/`calculerActionAlerte`.

| Champ | Type | Description |
|---|---|---|
| type | enum | `impaye` \| `entretien_equipement` \| `document_expire` \| `quittance_mensuelle` \| `revision_loyer` \| `autre` — les 3 dernières valeurs sont posées dès cette étape pour éviter une migration de plus, mais aucune logique ne les produit encore (étapes futures) |
| statut | enum | `a_faire` \| `en_cours` \| `fait` \| `annulee` |
| origine | enum | `alerte` \| `planifiee` \| `manuelle` — seule `alerte` est produite dans cette étape (par `TachesJobService`) |
| alerte_source_id | uuid, FK `alertes` | Alerte à l'origine de la tâche, uniquement pour `origine='alerte'`. Sert de clé d'idempotence (voir index unique ci-dessous) |
| bail_id | uuid, FK `baux` | Résolu depuis l'alerte source quand applicable (voir résolution par type ci-dessous) |
| appartement_id | uuid, FK `appartements` | Idem |
| bien_id | uuid, FK `bien` | Pour une tâche résolue au niveau du bien lui-même (ex. document expiré attaché à `documents.entiteType='bien'`), pas à un appartement ou un bail précis |
| locataire_id | uuid, FK `locataires` | Titulaire résolu via `resoudreTitulaire` (déterministe grâce à l'index unique titulaire actif, voir section `bail_locataires`) — `null` si le bail n'a aucun titulaire (colocataires uniquement). Renseigné pour `type='quittance_mensuelle'` depuis l'Étape 4 ; **renseigné pour les 4 autres types depuis le Module Tâches Étape 3 (Gmail, 2026-09-01)** — jusque-là `genererTachesDepuisAlertes`/`genererTachesRevisionLoyer` résolvaient déjà un titulaire pour construire la notification mais ne le persistaient jamais sur `tache.locataireId`, un trou bloquant pour `envoyerNotification` (voir section Gmail ci-dessous), corrigé rétroactivement |
| paiement_id | uuid, FK `paiements`, nullable | **Module Tâches, Étape 4 — quittance mensuelle, 2026-08-31.** Échéance à l'origine d'une tâche `type='quittance_mensuelle'`, jamais renseigné pour les autres types. Sert de clé d'idempotence (voir index unique ci-dessous), même principe que `alerte_source_id` |
| date_echeance | date | |
| date_completion | timestamptz | Posée automatiquement par `TachesService.marquerFait()`, jamais par un `update()` générique |
| periode_recurrence | text | Ex. `'2026-09'` — inutilisé dans cette étape, réservé aux tâches récurrentes futures (quittances mensuelles, révision de loyer) |
| notes | text | |
| metadata | jsonb | |
| organisation_id | uuid, FK `organisations`, NOT NULL | Scoping multi-tenant direct, même principe que `bien.organisationId` — résolu côté serveur depuis le bien concerné, jamais transmis par le client |

**Résolution par type d'alerte (`TachesJobService.genererTachesDepuisAlertes`)** —
`alertes` n'a pas de colonne `entiteType` générique (contrairement à
`documents`) : la table cible se déduit de `alerte.type` via une branche
dédiée par type, pas une requête uniforme.

- `impaye` : `entiteId` → `paiements.id` → `paiements.bailId` →
  `baux.appartementId`. Résout `bailId` et `appartementId`.
- `entretien_equipement` : `entiteId` → `equipements.id` →
  `equipements.appartementId`. Résout `appartementId` uniquement.
- `document_expire` (uniquement cette valeur, jamais `document_expire_proche`) :
  `entiteId` → `documents.id` → `documents.entiteType`/`documents.entiteId`.
  Si `entiteType='appartement'` : résout `appartementId` directement. Si
  `entiteType='bail'` : résout `bailId`, puis `appartementId` via
  `baux.appartementId`. Si `entiteType='bien'` : résout `bienId`
  directement, laisse `appartementId`/`bailId` à `null`. Pour tout autre
  `entiteType` (`sci`, `locataire`, `garant`, `etat_des_lieux`) : **aucune
  tâche générée** pour cette étape.
- `bail_fin_proche` et `document_expire_proche` : **exclus de la génération
  de tâches dans cette étape** — décision explicite, pas un oubli. L'alerte
  seule suffit pour l'instant ; à réévaluer dans une étape future si le
  besoin se confirme.

**Idempotence** : un index unique partiel garantit qu'il n'existe jamais
plus d'une tâche `a_faire`/`en_cours` à la fois pour une même
`alerte_source_id` — le job quotidien vérifie son existence avant toute
création plutôt que de s'appuyer sur une violation de contrainte. Même
principe pour `paiement_id` (index `tache_paiement_active_unique`, voir
section "Quittance mensuelle" ci-dessous).

## Quittance mensuelle (Module Tâches, Étape 4, 2026-08-31)
`TachesJobService.genererTachesQuittanceMensuelle()` (job quotidien) crée
une tâche `type='quittance_mensuelle'`/`origine='planifiee'` pour chaque
`paiements` de `type='loyer'` **effectivement réglé** (`statut='paye'`) sans
tâche active déjà liée (`paiement_id`) — jamais anticipée sur une échéance
à venir ou encore impayée/partielle : une quittance atteste un paiement
reçu, pas une échéance due. Idempotence par `paiement_id`, index unique
partiel `tache_paiement_active_unique` — même mécanique que
`tache_bail_periode_revision_active_unique` (section Révision de loyer).
Résout `bailId`/`appartementId` depuis le paiement, `locataireId` via
`resoudreTitulaire`, et la notification (`notificationObjet`/
`notificationCorps` dans `metadata`, modèle de courrier `code='quittance_mensuelle'`,
variables `nomLocataire`/`libelleBien`/`periode`/`montant`) — même
discipline "jamais silencieux" que l'extension notifications alertes
(`notificationIndisponible` + motif si titulaire/bien/modèle introuvable,
erreur de résolution jamais fatale au job).

**`QuittanceDocumentDocxService`** (`apps/backend/src/quittance-document-docx`,
route `POST /paiements/:id/document-quittance-docx`) génère le document
(docxtemplater/pizzip, chemin de template via `QUITTANCE_DOCUMENT_DOCX_
TEMPLATE_PATH`, même mécanique que `bail-document-docx`/
`etat-des-lieux-document-docx`) — jamais persisté (streamé au client
uniquement, cohérent avec les deux précédents). Lit directement
`paiements.loyer_hors_charges`/`paiements.charges` (jamais recalculés) et
bloque explicitement (`validerCompletudeGenerationQuittance`, packages/core)
si l'échéance est antérieure au 2026-08-31 (ces deux colonnes encore
`NULL`) plutôt que d'imprimer un montant recalculé potentiellement faux.
Date de règlement résolue via le dernier `versements` actif du paiement
(même précédent que "date de versement loyer précédent locataire" dans
`bail-document-docx.service.ts`). Résolution du bailleur partagée avec
`bail-document-docx` via `BienService.resoudreNomBailleur` (voir section
`bien`).

**Dette technique documentée** : l'échéance d'ENTRÉE générée par
`BauxService.activer()` (distincte du job récurrent
`genererEcheancesRecurrentes`) ne renseigne pas encore `loyer_hors_charges`/
`charges` — une quittance ne peut donc pas encore être générée pour le
premier mois d'un nouveau bail tant que cette échéance n'est pas figée a
posteriori. Voir docs/backlog.md, section Dette technique, pour le détail
et la piste de correctif (prorata à préserver exactement, sans dérive
d'arrondi entre les deux composantes).

## Gmail (Module Tâches, Étape 3 — intégration OAuth2, 2026-09-01)
Clôt le cycle "notification résolue en `metadata` mais jamais réellement
envoyée" ouvert depuis les étapes précédentes (alertes, révision de loyer,
quittance mensuelle) : `TachesService.envoyerNotification(id)` envoie
effectivement l'email via l'API Gmail (compte Google de l'utilisateur,
jamais un compte technique partagé) et clôt la tâche — jamais l'inverse
(voir plus bas, "jamais fait sur un échec d'envoi").

### connexion_gmail
| Champ | Type | Description |
|---|---|---|
| organisation_id | uuid, FK `organisations`, NOT NULL | Une connexion Gmail par organisation (pas par utilisateur) — le compte Gmail connecté envoie au nom de l'organisation |
| email_compte | text | Adresse du compte Gmail connecté, résolue via `users.getProfile` au moment du callback OAuth — jamais saisie manuellement |
| access_token_chiffre | text | AES-256-GCM via `EncryptionService`, même mécanique que `comptes_bancaires_sci.iban_chiffre`/`bic_chiffre` (voir section `comptes_bancaires_sci`) — jamais de jeton en clair en base |
| refresh_token_chiffre | text | Idem. Jamais écrasé par un rafraîchissement de l'access token (Google ne le renvoie que lors du tout premier consentement, ou d'une reconnexion avec `prompt=consent`) |
| expires_at | timestamptz | Expiration réelle de l'access token — `GoogleOAuthService.obtenirAccessTokenValide` rafraîchit par anticipation avec une marge de 60s |
| scope | text | `https://www.googleapis.com/auth/gmail.send` uniquement — jamais `gmail.readonly`/`gmail.modify`, l'app n'a besoin que d'envoyer |

Index unique partiel `connexion_gmail_organisation_active_unique` sur
`(organisation_id)` où `archived_at IS NULL` : une reconnexion **archive**
l'ancienne ligne active plutôt que de la modifier en place — historique
conservé, même principe que `revision_loyer`.

### Flux OAuth2 (`apps/backend/src/google-oauth`)
`GoogleOAuthService.genererUrlConsentement(utilisateurId)` signe un `state`
via le `JwtService` global de l'application (même secret `JWT_SECRET` que
les JWT applicatifs — **pas un nouveau secret provisionné**, distingué par
un claim `purpose: "gmail_oauth_state"`), TTL 5 minutes : protection CSRF
stateless, aucune table de sessions OAuth. Le navigateur système (jamais
une fenêtre Electron interne) affiche le consentement Google, puis
redirige vers `GET /gmail/callback` — deuxième route `@Public()` du
projet après `POST /auth/login` (voir section Authentification), protégée
non pas par le JWT applicatif mais par la vérification de signature/
fraîcheur du `state` dans `GoogleOAuthService.traiterCallback`. Réponse :
une page HTML minimale ("Connexion réussie, fermez cette fenêtre") — aucune
redirection vers l'app desktop, impossible depuis un navigateur système
générique ; l'écran Paramètres reflète l'état à sa prochaine ouverture
(`GET /gmail/statut`, pas de polling).

**Scopes demandés : `openid email` + `gmail.send`.** `openid`/`email` sont
non sensibles (aucune review Google requise) et servent uniquement à
obtenir un `id_token` (JWT OpenID Connect) dans la réponse d'échange de
code — `gmail.send` seul ne donne accès à aucun endpoint de lecture, pas
même `users.getProfile` (voir "Dette technique corrigée" ci-dessous).
`emailCompte` est décodé directement depuis le claim `email` de cet
`id_token` (`GoogleOAuthService.decoderEmailDepuisIdToken`), **sans
vérification de signature** — l'`id_token` est obtenu directement depuis
`oauth2.googleapis.com/token` en HTTPS serveur-à-serveur, jamais transmis
par le client ni exposé à une falsification possible ; Google documente ce
cas comme dispensé de vérification (contrairement à un `id_token` reçu
côté client).

Côté desktop : canal IPC générique `shell:openExternal` (`apps/desktop/src/
main/index.ts`, restreint à `http(s)`) ouvre l'URL de consentement dans le
navigateur système — deuxième précédent après le `setWindowOpenHandler`
passif déjà en place, mais celui-ci déclenchable depuis le renderer.

### envoyerNotification (`TachesService.envoyerNotification`, `PATCH /taches/:id/envoyer-notification`)
Action générique aux 5 types de tâche, pas spécifique à un type : lit
`metadata.notificationObjet`/`notificationCorps` déjà résolus en amont
(alertes, révision de loyer, quittance mensuelle — voir sections
correspondantes), résout le destinataire via `tache.locataireId` →
`locataires.email`. **Ne tente jamais un envoi sans destinataire certain** :
`BadRequestException` explicite si `locataireId` est `null`, si le
locataire n'a pas d'email, ou si `metadata.notificationIndisponible` était
posé en amont (message reprenant `motifNotificationIndisponible`) — jamais
une adresse devinée ou un envoi silencieusement sauté.

Pour `type='quittance_mensuelle'` : génère le `.docx` à la volée via
`QuittanceDocumentDocxService.genererDocumentQuittanceDocx` et l'attache
(pas de PDF — décision actée : `QuittanceDocumentDocxService` ne produit
que du `.docx`, aucune conversion PDF dans ce codebase depuis le retrait de
`pdfmake`, voir section Quittance mensuelle).

**Jamais `fait` sur un échec d'envoi** : le passage à `statut='fait'` +
`dateCompletion` n'est atteint qu'après un `GoogleOAuthService.envoyerEmail`
réussi — toute exception (Gmail non connecté, jeton révoqué, erreur API)
remonte telle quelle au frontend et la tâche reste dans son statut courant,
jamais fermée sur un envoi qui n'a pas eu lieu.

**Dette technique corrigée (2026-09-04)** : la version initiale de cette
étape appelait `users.getProfile` avec le seul scope `gmail.send` pour
résoudre `email_compte` — risque de blocage identifié avant le premier
test réel (`gmail.send` ne donne accès à aucun endpoint de lecture Gmail,
`users.getProfile` inclus). Remplacé par le décodage de l'`id_token`
obtenu via les scopes `openid`/`email` (voir ci-dessus) — élimine l'appel
HTTP et la dépendance à un scope non couvert par la configuration Google
Cloud existante. **Action requise côté Google Cloud Console (Data
access)** : ajouter `openid` et `.../auth/userinfo.email` (ou `email`) à
la liste des scopes autorisés de l'écran de consentement OAuth, en plus de
`gmail.send` déjà configuré — scopes non sensibles, aucune review Google,
ajout en quelques secondes.

## modele_courrier (Module Tâches, Étape 2, 2026-08-29)
Brique transverse, pas un module à part entière — infrastructure de modèle
de message texte avec substitution de variables, posée en même temps que
Tâches plutôt que raccordée après coup (prévu dès la feuille de route,
docs/backlog.md). **Cette étape ne pose que l'infrastructure et un modèle
d'exemple fictif** : le vrai contenu de quittance (texte final, vraies
variables) arrive à l'Étape 4, une fois les données réellement disponibles
à la génération de quittance connues avec certitude.

À ne pas confondre avec le mécanisme docxtemplater
(`bail-document-docx.service.ts`, `etat-des-lieux-document-docx.service.ts`) :
celui-ci remplit un fichier `.docx` binaire sur disque via un mapping de
balises codé en dur dans le service — `modele_courrier` stocke un texte en
base (typiquement un email), résolu par substitution `{{variable}}` via
`packages/core`, `resoudreModeleCourrier`. Deux mécanismes distincts pour
deux besoins distincts (document contractuel complexe vs message court),
aucune duplication.

| Champ | Type | Description |
|---|---|---|
| code | text, unique | Identifiant stable utilisé par le code consommateur (ex. `'quittance_mensuelle'`), jamais l'id technique — permet de faire évoluer le contenu d'un modèle sans casser les appelants |
| nom | text | Libellé lisible |
| canal | enum | `'email'` uniquement pour l'instant. `pgEnum` retenu plutôt que `text+CHECK` malgré la valeur unique actuelle : aucun précédent `text+CHECK` dans ce schéma, et `canal` est explicitement destiné à grandir (`'lettre'`, puis SMS/notification via le futur module Messagerie) — ce codebase a déjà fait grandir un `pgEnum` existant via `ALTER TYPE ... ADD VALUE` plusieurs fois (ex. `document_entite_type`) |
| objet | text, nullable | Sujet d'email — nullable car un futur canal `'lettre'` n'en a pas |
| corps | text | Syntaxe `{{variable}}`, résolue par `resoudreModeleCourrier` |
| variables_requises | jsonb | Array de string, noms des variables attendues — permet à un appelant de valider ses données avant résolution, sans reparser `corps` à chaque appel |
| organisation_id | uuid, FK `organisations`, NOT NULL | Scoping multi-tenant, transmis explicitement par l'appelant (pas dérivé d'un `userId` comme `BienService.create` — `upsertModeleCourrier` reçoit directement `organisationId`) |

**`resoudreModeleCourrier`** (`packages/core`, pure, sans base de données) :
remplace chaque `{{cle}}` de `objet`/`corps` par `variables[cle]` ; lève une
erreur explicite listant la ou les variables manquantes plutôt que de
laisser un `{{cle}}` littéral dans le résultat (jamais de substitution
silencieuse).

**`ModelesCourrierService`** : `findByCode(code)` (résolution par le
consommateur) et `upsertModeleCourrier(...)`, idempotent par `code` —
réutilisable par tout script de seed futur (quittance à l'Étape 4). Pas
d'endpoints HTTP `create()`/`update()` exposés dans cette étape : aucun
écran d'édition prévu pour l'instant, décision explicite.

**Aucun Sync Stream PowerSync** pour cette table dans cette étape : rien
côté desktop ne lit `modele_courrier` (pas d'écran d'édition) — un stream
sans consommateur serait de la conception anticipée non justifiée, à
ajouter plus tard si/quand un écran d'édition est construit.

## Révision de loyer (Module Tâches, Étape 5, 2026-08-30)
Comble le trou documenté depuis le Module Tâches Étape 1 : `baux.loyer_mensuel`
ne portait que la valeur courante, sans aucune trace des révisions passées
(`revisions_loyer` n'était qu'un nom réservé dans la liste "Tables prévues
mais non modélisées", voir plus bas).

**Date anniversaire de révision** = même mois/jour que `baux.date_debut`,
chaque année — choix par défaut faute de champ dédié, décision actée avec
l'utilisateur (pas de meilleure source identifiée en cours
d'implémentation).

**`packages/core`, `calculerRevisionLoyer(loyerActuel, indiceReference,
indicePrecedent)`** : formule légale `loyerActuel × indiceReference /
indicePrecedent`. Signature en `string`, **pas en `number`** — même
convention que `montantEnCentimes`/`centimesVersMontant`
(`packages/core/src/paiements/montant.ts`) et
`calculerProrataOccupationPartielle` (calcul de même forme, montant × ratio) :
conversion en centimes entiers, `Math.trunc` sur le ratio, jamais de
flottant sur le chemin financier. Lève une erreur explicite si
`indicePrecedent <= 0`. Une révision peut **réduire** le loyer (indice en
baisse), pas seulement l'augmenter.

**`IndicesIrlService.trouverValeur(annee, trimestre)`** : lookup ciblé
(absent avant cette étape, seul `obtenirDerniereValeur()` existait) —
retourne `null` si l'indice n'est pas encore publié pour ce couple, ne
lève jamais d'erreur (le job réessaiera le lendemain).

**`TachesJobService.genererTachesRevisionLoyer(dateReference)`** : pour
chaque bail `actif` avec `trimestre_reference_revision` renseigné, dont le
mois/jour de `date_debut` correspond à `dateReference` (anniversaire) :
idempotence via `tache_bail_periode_revision_active_unique`
`(bail_id, periode_recurrence)` scopé `type='revision_loyer'` — 
`periode_recurrence` porte l'année courante en texte (ex. `'2026'`).
Cherche `indiceReference` (année courante, trimestre de référence) et
`indicePrecedent` (année - 1, même trimestre) via `trouverValeur()` ; si
l'un des deux est absent, **ne crée rien** (pas de garde-fou
supplémentaire nécessaire, le job repasse chaque jour). Si les deux sont
disponibles, calcule le loyer proposé et crée une `tache`
(`type='revision_loyer'`, `origine='planifiee'`, `dateEcheance` = date
anniversaire, `metadata` contenant loyer actuel/proposé, trimestre/année
et valeurs des deux indices utilisés).

**`TachesService.appliquerRevision(id, nouveauLoyerValide)`** — action
dédiée, **pas `marquerFait`** : le montant proposé par le job doit pouvoir
être ajusté avant application, jamais appliqué automatiquement.
1. Valide `type='revision_loyer'` et `statut='a_faire'`.
2. Crée la ligne `revision_loyer` (historique complet : `loyer_avant` lu
   **fraîchement** sur `baux.loyer_mensuel` au moment de l'application, pas
   depuis le `metadata` de la tâche qui a pu devenir obsolète entre temps).
3. Met à jour `baux.loyer_mensuel = nouveauLoyerValide`.
4. Résout le modèle de courrier `revision_loyer` (`ModelesCourrierService.
   findByCode` + `resoudreModeleCourrier`) avec les vraies variables
   (nom du/des locataire(s) joints via `formaterListeNoms`, libellé
   bien/appartement, loyer avant/après, date d'effet), stocke `objet`/
   `corps` résolus dans `tache.metadata`.
5. Passe `tache.statut = 'en_cours'` — **jamais `fait`** directement :
   `en_cours` signifie "appliqué financièrement, notification en attente"
   ; `fait` ne sera posé qu'une fois l'email réellement envoyé (Étape 3/4,
   actuellement bloquée sur la vérification Google OAuth — l'envoi Gmail
   lui-même est hors périmètre de cette étape, `TODO` explicite laissé à
   l'endroit exact où il sera branché).

## revision_loyer
| Champ | Type | Description |
|---|---|---|
| bail_id | uuid, FK `baux`, NOT NULL | |
| tache_id | uuid, FK `tache`, nullable | Nullable délibérément : l'historique financier ne doit jamais dépendre du cycle de vie d'une tâche (une tâche pourrait en théorie être nettoyée plus tard, la révision appliquée reste tracée) |
| date_effet | date, NOT NULL | Date anniversaire à laquelle la révision prend effet |
| loyer_avant, loyer_apres | decimal, NOT NULL (les deux) | Même précision que `baux.loyer_mensuel` (10,2) |
| trimestre_reference | integer, NOT NULL | Copie de `baux.trimestre_reference_revision` au moment de l'application — trace même si le bail change de trimestre de référence plus tard |
| annee_reference | integer, NOT NULL | Année courante utilisée pour le calcul — `indice_reference_valeur` porte sur cette année, `indice_precedent_valeur` sur `annee_reference - 1`, même trimestre |
| indice_reference_valeur, indice_precedent_valeur | decimal(6,2), NOT NULL (les deux) | Valeurs IRL effectivement utilisées pour ce calcul, tracées même si `indices_irl` est corrigé rétroactivement plus tard |
| organisation_id | uuid, FK `organisations`, NOT NULL | |

Jamais de `update()` prévu sur cette table : une révision appliquée est un
fait historique, pas modifiable après coup (cohérent avec la règle CLAUDE.md
"jamais de suppression physique" — ici, jamais de correction physique non
plus).

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

## indices_irl
Table de référence (série INSEE BDM 001515333, "Indice de référence des
loyers") — pas de colonnes d'audit standard (created_at/updated_by/version/
archived_at), même principe que `journal_audit` : une valeur publiée n'est
jamais modifiée après coup, seule une nouvelle ligne (nouveau trimestre)
peut être ajoutée. Alimentée exclusivement par `IndicesIrlJobService`
(`apps/backend/src/indices-irl/`), jamais par saisie manuelle.
| Champ | Type | Description |
|---|---|---|
| annee, trimestre | integer | Contrainte d'unicité `(annee, trimestre)` — une seule ligne par trimestre publié, insertion idempotente (`onConflictDoNothing`) |
| valeur | decimal | Valeur de l'indice telle que publiée par l'INSEE |
| date_recuperation | timestamp with time zone | Date à laquelle la tâche planifiée a récupéré cette valeur — sert de signal de fraîcheur (`packages/core`, `irlEstPerime`) : la génération du bail bloque si la ligne la plus récente date de plus de 4 mois, ou si la table est vide. Jamais un texte "à compléter" inséré à la place (docs/backlog.md, section "Édition d'un bail") |

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

## Authentification et autorisation (backend)

**Décision produit (garde globale, tranchée avec l'utilisateur,
2026-08-11)** : `JwtAuthGuard` est enregistrée comme garde globale
(`APP_GUARD`, `apps/backend/src/auth/auth.module.ts`) — toute route
protège par défaut, échec sécurisé, plutôt que de compter sur l'ajout
manuel de `@UseGuards(JwtAuthGuard)` sur chaque nouveau controller. Même
principe que `JWT_SECRET`/`ENCRYPTION_KEY` qui bloquent le démarrage en
production plutôt que de se reposer sur la vigilance humaine (voir
docs/error-log.md). Seules les routes explicitement décorées `@Public()`
(`apps/backend/src/auth/public.decorator.ts`) échappent à la garde —
aujourd'hui uniquement `POST /auth/login`, seule route qui ne peut pas
exiger un JWT pour en délivrer un.

Vérifié empiriquement (pas seulement par lecture de code) : les 139 tests
d'intégration existants passent inchangés (aucun n'exerce la couche HTTP,
tous appellent les services directement — la garde n'y est donc jamais
sollicitée) ; en conditions réelles, `POST /auth/login` reste accessible
sans JWT (message `"Identifiants invalides"` renvoyé, preuve que la
requête atteint bien le controller) tandis qu'un accès sans JWT à
`/scis`, `/paiements`, `/documents` ou `/tableau-de-bord/en-tete` est
bloqué par la garde (`"Unauthorized"`, avant tout code applicatif) ; un
JWT valide donne bien accès à ces mêmes routes.

**Règle pour un futur endpoint `/health`** : s'il est ajouté un jour
(monitoring Scaleway Serverless Containers, qui ne peut pas envoyer de
JWT), il devra utiliser explicitement `@Public()`, comme
`POST /auth/login` aujourd'hui — jamais public par oubli. Son corps de
réponse doit rester un statut minimal (ex. `{ status: "ok" }` ou un
simple code HTTP), **jamais** de détail de connexion DB, de version
applicative, ou de stack trace : un endpoint volontairement non
authentifié est par nature accessible à quiconque atteint le conteneur.

### Sécurité PowerSync — deux mécanismes de protection distincts, à ne jamais confondre

Découvert le 2026-08-13 en inspectant directement le fichier SQLite local
(`powersync.db`) après le premier test réel du Sync Stream `scis`, pas
supposé : **le schéma client PowerSync (`apps/desktop/src/main/powersync/
schema.ts`, `Table`/`column`) ne restreint que la *vue* exposée à
l'application** (la table SQL que l'app interroge, ex. `scis`). Il ne
restreint **jamais** ce qui est physiquement écrit sur le disque de
l'appareil. La table interne `ps_data__<nom_table>` contient le JSON
**complet** renvoyé par la requête du Sync Stream — inspecté directement :
`ps_data__scis` contenait `adresse`/`code_postal`/`ville`/`telephone`/
`nom_gerant` en clair, alors que le schéma client ne déclarait que
`nom`/`regime_fiscal`/`statut`. Sur cette table précise, sans gravité
(aucune de ces colonnes n'est sensible) — mais le mécanisme réel est à
retenir pour toute extension future.

**Règle absolue pour toute future table ajoutée à un Sync Stream** :
la requête du stream (dashboard PowerSync) ne doit **jamais** utiliser
`SELECT *` — toujours une liste de colonnes explicite, correspondant
exactement à ce qu'on accepte de voir stocké en clair sur l'appareil
local. Le stream `scis` a été corrigé selon cette règle dès sa
découverte (voir docs/backlog.md), pour servir de modèle correct plutôt
que de mauvais exemple copié-collé lors des extensions par domaine
(`indices_irl`, `locataires`, `paiements`...). Même principe que la
projection explicite déjà appliquée à `DocumentsService.versDto`
(voir docs/backlog.md, section Dette technique) : ne jamais laisser un
mécanisme bas niveau (spread de ligne de base, `SELECT *`) décider
implicitement de ce qui sort du système.

**Ce mécanisme est distinct — et strictement plus faible — que
l'exclusion de `journal_audit`.** `journal_audit` n'est protégée par
*aucune écriture prudente de requête* : elle est absente de
`CREATE PUBLICATION powersync FOR TABLE (...)` elle-même (voir
docs/integrations.md et docs/backlog.md). Conséquence structurelle :
PowerSync ne reçoit **jamais** la moindre ligne de `journal_audit` via
la réplication logique, quel que soit le contenu d'un futur Sync
Stream — il n'existe tout simplement aucune copie de cette table côté
PowerSync dans laquelle un `SELECT *` malencontreux pourrait puiser. Ce
n'est pas une question de requête bien ou mal écrite (comme pour
`scis`), c'est une impossibilité structurelle en amont. Complété par
`REVOKE SELECT ON journal_audit FROM powersync_role` (vérifié via
`has_table_privilege`) en défense supplémentaire — mais la publication
est la vraie barrière, le `REVOKE` n'est qu'une seconde ligne de
défense pour le cas où quelqu'un tenterait une requête ad hoc hors du
mécanisme normal de PowerSync.

En résumé : **`journal_audit` = protégée à la source (publication
Postgres), aucune vigilance de requête requise. Toute autre table
présente dans la publication = protégée uniquement par la rigueur de la
requête du Sync Stream (liste de colonnes explicite), vigilance requise
à chaque extension.**

---

## État des lieux (module, 2026-08-03)

Schéma en **modélisation littérale** (Option B, validée avec le propriétaire
après comparaison de trois approches) : une table par groupe de pièce du
modèle Word réel (`tmp/Modèle état des lieux.docx`), pas de catalogue de
types de pièces/éléments en base — le décret n° 2016-382 et le modèle du
propriétaire sont fixes, la flexibilité d'un catalogue générique ne serait
jamais exploitée et autoriserait structurellement des combinaisons
incohérentes (ex. "hotte" sur une "entrée").

Deux échelles distinctes, jamais harmonisées (décision assumée) :
`etat_des_lieux_element_etat` (M/P/B/TB, décret n° 2016-382 art. 2) pour les
pièces, `etat_des_lieux_inventaire_etat` (bon/dusage/mauvais) pour
l'inventaire meublé et pour "ÉQUIPEMENTS DIVERS".

### etats_des_lieux
Un seul enregistrement par bail (`bail_id` unique) : le même document
couvre l'entrée et la sortie (décret, art. 3, 2° — "document unique"
permettant la comparaison), jamais deux lignes séparées. Statut jamais
stocké, toujours dérivé de `date_entree`/`date_sortie`
(`calculerStatutEtatDesLieux`, packages/core), même principe que
`calculerStatutPaiement`.
| Champ | Type | Description |
|---|---|---|
| bail_id | uuid, unique | Le bail concerné |
| date_entree, date_sortie | date, nullable | `date_sortie` reste `null` potentiellement des mois ou années après la création, jusqu'à la visite de sortie |
| nouvelle_adresse_locataire | text, nullable | Seul champ "domicile" du locataire porté par ce document (décret, art. 2, 2° a) — connu uniquement à la sortie. Texte libre, décision assumée |

### etat_des_lieux_compteurs (1:1 avec etats_des_lieux)
Relevés (décret, art. 2, 1° f — "le cas échéant"). Colonne Internet
retirée du modèle réel par le propriétaire (aucun champ structuré
derrière). Pas de numéro de compteur pour l'eau, absent du modèle réel.
Champs `electricite_*`/`gaz_*`/`eau_*`, chacun doublé `_entree`/`_sortie` —
voir `packages/db/src/schema/etat-des-lieux-compteurs.ts` pour le détail
complet (numéro de compteur, relève HP/HC, ancien occupant pour
l'électricité ; numéro + relève pour le gaz ; relève froide/chaude pour
l'eau).

### etat_des_lieux_cles
Une ligne par type de clé, pas des colonnes répétées.
| Champ | Type | Description |
|---|---|---|
| type_cle | enum | `immeuble` \| `porte_entree` \| `boite_lettres` \| `cave` \| `badge_portail` \| `parking` \| `autre` (2 emplacements libres dans le modèle réel, distingués par une ligne chacun) |
| libelle_autre | text, nullable | Renseigné uniquement si `type_cle = "autre"` |
| nombre_entree, nombre_sortie | integer, nullable | |
| commentaire | text, nullable | |

**Écriture (`etat_des_lieux_cles`, `etat_des_lieux_equipements_divers`,
`etat_des_lieux_inventaire`) — upsert par id explicite, jamais un
remplacement en bloc.** Décision revue le 2026-08-06 après relecture
critique : un simple `DELETE` puis `INSERT` de la liste entière à chaque
soumission (approche initiale) suppose que le client renvoie toujours
l'état complet de la section — hypothèse jamais garantie côté serveur, et
fausse par construction dès que l'entrée et la sortie sont soumises à des
mois d'écart via deux écrans distincts. Une soumission de sortie qui ne
renverrait que les champs `*_sortie` aurait silencieusement effacé les
valeurs d'entrée. Corrigé par `EtatsDesLieuxService.upsertEtArchiverParId`
(clés, équipements divers — pas de clé naturelle stable côté client) et
`upsertEtArchiverParElementId` (inventaire — `element_id` sert déjà de
clé naturelle, contrainte d'unicité `(etat_des_lieux_id, element_id)`) :
une ligne avec `id` mais introuvable est rejetée (id périmé/étranger),
une ligne existante non mentionnée dans la soumission n'est **jamais**
modifiée, et la suppression n'est **jamais** implicite — seuls les ids
listés explicitement dans `idsASupprimer` (`elementsASupprimer` pour
l'inventaire) sont archivés (`archived_at`, jamais de `DELETE` sur une
table métier — CLAUDE.md). Les lectures (`findById`/`findByBailId`)
filtrent `archived_at IS NULL` par défaut, sauf paramètre `avecArchives`
(ajouté le 2026-08-06 pour que la vue de relecture desktop puisse
réafficher ces lignes via le composant `ArchiveToggle`/`ArchiveBadge`
partagé — sans lui, une ligne archivée devenait invisible pour de bon,
faute de tout moyen de la revoir). Vérifié par un test d'intégration réel
reproduisant exactement ce scénario (entrée préservée après une
soumission de sortie qui ne la mentionne pas) et un test dédié pour
`avecArchives`.

### Pièces (etat_des_lieux_piece_entree / _sejour / _cuisine / _pieces_chambre / _pieces_salle_de_bain / _pieces_wc / _pieces_autre)
Chaque élément porte trois colonnes : `..._description` (texte libre,
colonne "Description / détails" à part entière du modèle réel, distincte
de la lettre), `..._etat_entree`, `..._etat_sortie` (M/P/B/TB). Socle
commun à toutes les pièces : mur, sol, **vitrage_volets** (uniforme sur
toutes les pièces y compris le séjour — l'incohérence du modèle initial,
"Vitrage" sans volets sur le séjour, a été corrigée par le propriétaire),
plafond, eclairage, prises (+ `prises_nombre`, integer, non doublé
entrée/sortie — un comptage physique, pas un état).

Spécifiques par pièce :
- `etat_des_lieux_piece_entree` (1:1, `etat_des_lieux_id` unique) : + porte, sonnette
- `etat_des_lieux_piece_sejour` (1:1) : socle seul
- `etat_des_lieux_piece_cuisine` (1:1) : + placards, evier, plaques_cuisson, hotte, + `electromenager_description` (texte libre, sans échelle d'état — ligne "Électroménager : ……" du modèle réel, distincte de l'inventaire meublé : un four/des plaques encastrés existent même en bail vide, décision assumée)
- `etat_des_lieux_pieces_chambre` (jusqu'à 3 lignes, `numero` 1-3, contrainte d'unicité `(etat_des_lieux_id, numero)`) : socle seul
- `etat_des_lieux_pieces_salle_de_bain` (jusqu'à 2 lignes, même contrainte) : + lavabo, baignoire
- `etat_des_lieux_pieces_wc` (jusqu'à 2 lignes, même contrainte) : + lavabo, wc (la cuvette elle-même, élément distinct du lavabo)
- `etat_des_lieux_pieces_autre` (jusqu'à 2 lignes, même contrainte + `libelle` texte libre) : socle seul — 2 emplacements libres, utilisés soit pour un dépassement (ex. "Chambre 4"), soit pour une pièce non standard

### etat_des_lieux_equipements_divers
Liste extensible, libellé saisi librement — pas de catalogue fixe
(décision du propriétaire). Section "ÉQUIPEMENTS DIVERS" du modèle réel,
placée **hors** du bloc `{#meublé}` : applicable à tout bail, vide ou
meublé. Échelle bon/dusage/mauvais (comme l'inventaire meublé), pas
M/P/B/TB.
| Champ | Type | Description |
|---|---|---|
| libelle | text | Saisi librement |
| nombre_entree, etat_entree, nombre_sortie, etat_sortie | nullable | |
| commentaire | text, nullable | |

### elements_inventaire_meuble (catalogue de référence)
88 postes fixes du modèle réel (section inventaire du bail meublé, bloc
`{#meublé}` : MEUBLES, ÉLECTRO-MÉNAGER, et les colonnes d'impression
"ÉQUIPEMENT 1"/"ÉQUIPEMENT 2" fusionnées dans `vaisselle_linge` — 21 + 17
+ 50), table seed — non modifiable en usage courant. Seedé par
`apps/backend/scripts/seed-inventaire-meuble.ts` (`pnpm seed:inventaire-meuble`),
idempotent (`onConflictDoUpdate` sur `code`).
| Champ | Type | Description |
|---|---|---|
| code | text, unique | |
| libelle | text | |
| categorie | enum | `meuble` \| `electromenager` \| `vaisselle_linge` — cette dernière regroupe les colonnes d'impression "ÉQUIPEMENT 1"/"ÉQUIPEMENT 2" du modèle réel, qui n'ont aucune signification métier (mise en page uniquement) |
| ordre_affichage | integer | Reproduit l'ordre du modèle réel plutôt qu'un tri alphabétique |

### etat_des_lieux_inventaire
Pertinent uniquement pour un bail meublé (`bail.type_bail = "meuble"`,
bloc `{#meublé}` du modèle Word) — règle applicative, aucune contrainte
de schéma ne l'impose. Contrainte d'unicité `(etat_des_lieux_id,
element_id)`. Échelle bon/dusage/mauvais, volontairement **non
harmonisée** avec l'échelle M/P/B/TB des pièces — décision assumée avec
le propriétaire (trop complexe à détailler pour du mobilier, la colonne
commentaires compense).
| Champ | Type | Description |
|---|---|---|
| element_id | uuid | FK vers `elements_inventaire_meuble` |
| nombre_entree, etat_entree, nombre_sortie, etat_sortie | nullable | |
| commentaire | text, nullable | |

**Accès mobile** : page web légère, API REST directe sur `apps/backend`,
pas de SDK PowerSync web — voir `docs/app-spec.md`, section 3, pour le
raisonnement complet. Chaque pièce se soumet indépendamment à la
validation, jamais un envoi global en fin de visite : en cas d'échec
réseau, blocage explicite avec message clair et bouton "Réessayer",
aucune colonne de statut de synchronisation nécessaire sur les tables
ci-dessus.

---

## Tables prévues mais non modélisées en détail (post-MVP)

Points d'ancrage déjà identifiés pour ne pas casser le schéma existant :
- `charges_annuelles` (liée à `baux` et `appartements`)
- `travaux` (liée à `appartements`)

`revisions_loyer` a été retiré de cette liste le 2026-08-30 : implémenté
sous le nom `revision_loyer` (singulier, cohérent avec les autres tables du
schéma) — voir section "Révision de loyer" ci-dessus.

## Modules à venir

Feuille de route et ordre de priorité des modules post-MVP (Tâches,
Charges et fiscalité, Messagerie interne, Suivi sinistre et assurance,
Carnet de contacts, Modèles de courriers/lettres) : voir `docs/backlog.md`,
section "Modules futurs — feuille de route" — pas dupliquée ici, ce
document reste focalisé sur le schéma existant, pas sur la planification.

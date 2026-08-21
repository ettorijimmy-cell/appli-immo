import { column, Schema, Table } from "@powersync/node";

// Étendue table par table dans l'ordre de dépendance des Modules, jamais en
// bloc (voir docs/backlog.md, chantier PowerSync). Les colonnes déclarées
// ici doivent correspondre EXACTEMENT à la liste de colonnes de la requête
// du Sync Stream correspondant dans docs/powersync-sync-streams.yaml — pas
// plus, pas moins. `id` est généré automatiquement par PowerSync (colonne
// text), jamais déclaré ici.
const scis = new Table({
  nom: column.text,
  regime_fiscal: column.text,
  statut: column.text
});

const immeubles = new Table({
  sci_id: column.text,
  nom: column.text,
  adresse: column.text,
  code_postal: column.text,
  ville: column.text,
  type_habitat: column.text,
  regime_juridique: column.text,
  annee_construction: column.integer,
  statut: column.text,
  updated_at: column.text
});

// identifiant_fiscal volontairement absent — exclu du Sync Stream
// appartements (donnée fiscale nominative du lot, voir
// docs/powersync-sync-streams.yaml).
const appartements = new Table({
  immeuble_id: column.text,
  numero: column.text,
  type: column.text,
  surface: column.real,
  loyer_reference: column.real,
  nombre_pieces_principales: column.integer,
  mode_chauffage: column.text,
  mode_eau_chaude: column.text,
  type_energie: column.text,
  equipement_cuisine: column.text,
  dependances_annexes: column.text,
  nombre_chambres: column.integer,
  nombre_salles_de_bain: column.integer,
  nombre_wc: column.integer,
  autre_piece_1: column.text,
  autre_piece_2: column.text,
  statut: column.text,
  updated_at: column.text
});

// Pas de statut sur cette table côté Drizzle (aucun pgEnum de statut
// défini pour equipements, contrairement à scis/immeubles/appartements).
const equipements = new Table({
  appartement_id: column.text,
  type: column.text,
  date_dernier_entretien: column.text,
  intervalle_entretien_mois: column.integer,
  updated_at: column.text
});

const baux = new Table({
  appartement_id: column.text,
  type_bail: column.text,
  statut: column.text,
  loyer_mensuel: column.real,
  depot_garantie: column.real,
  provisions_charges: column.real,
  jour_echeance: column.integer,
  date_debut: column.text,
  date_fin: column.text,
  date_activation: column.text,
  date_signature: column.text,
  date_resiliation: column.text,
  travaux_realises: column.text,
  honoraires_bailleur: column.real,
  honoraires_locataire: column.real,
  updated_at: column.text
});

// profession et revenus volontairement absents — exclus du Sync Stream
// garants (donnée financière précise du garant, voir
// docs/powersync-sync-streams.yaml).
const garants = new Table({
  bail_id: column.text,
  nom: column.text,
  prenom: column.text,
  email: column.text,
  telephone: column.text,
  type_garantie: column.text,
  adresse: column.text,
  code_postal: column.text,
  ville: column.text,
  date_naissance: column.text,
  lieu_naissance: column.text,
  nationalite: column.text,
  updated_at: column.text
});

const bail_locataires = new Table({
  bail_id: column.text,
  locataire_id: column.text,
  role: column.text,
  updated_at: column.text
});

// anonymise_le inclus bien qu'inexploité côté code à ce jour (mécanisme
// RGPD documenté mais jamais implémenté — voir docs/backlog.md, dette
// technique) : la colonne doit déjà être présente côté client pour le
// jour où il le sera.
const locataires = new Table({
  nom: column.text,
  prenom: column.text,
  email: column.text,
  telephone: column.text,
  adresse: column.text,
  code_postal: column.text,
  ville: column.text,
  date_naissance: column.text,
  statut: column.text,
  anonymise_le: column.text,
  updated_at: column.text
});

const paiements = new Table({
  bail_id: column.text,
  type: column.text,
  statut: column.text,
  montant: column.real,
  date_echeance: column.text,
  updated_at: column.text
});

// reference_rapprochement volontairement absente — exclue du Sync Stream
// versements (libellé brut de ligne de relevé bancaire importé, hors de
// notre contrôle, voir docs/powersync-sync-streams.yaml).
const versements = new Table({
  paiement_id: column.text,
  montant: column.real,
  date_versement: column.text,
  mode: column.text,
  updated_at: column.text
});

// commentaire volontairement absent — exclu du Sync Stream remboursements
// (texte libre non contraint, saisi manuellement, voir
// docs/powersync-sync-streams.yaml).
const remboursements = new Table({
  bail_id: column.text,
  paiement_id: column.text,
  type: column.text,
  montant_origine: column.real,
  montant_rembourse: column.real,
  date_remboursement: column.text,
  mode: column.text,
  updated_at: column.text
});

// Config globale mono-utilisateur (une ligne par type d'alerte, 5 lignes
// maximum), sans rattachement SCI/utilisateur — synchronisée sans filtre
// par hiérarchie, voir docs/powersync-sync-streams.yaml. Stream alertes
// lui-même reporté après le domaine Documents (entite_id polymorphe,
// dépend de la conception du Sync Stream documents — voir même fichier).
const parametres_alertes = new Table({
  type: column.text,
  seuil_jours_avant: column.integer,
  updated_at: column.text
});

// Pas de updated_at sur cette table côté Drizzle (pas les auditColumns
// standard — une valeur IRL publiée n'est jamais modifiée après coup, voir
// docs/powersync-sync-streams.yaml). date_recuperation en tient lieu.
const indices_irl = new Table({
  annee: column.integer,
  trimestre: column.integer,
  valeur: column.real,
  date_recuperation: column.text
});

const elements_inventaire_meuble = new Table({
  code: column.text,
  libelle: column.text,
  categorie: column.text,
  ordre_affichage: column.integer,
  updated_at: column.text
});

// chemin_stockage volontairement absent — EXCLU DÉFINITIVEMENT du Sync
// Stream documents (clé/chemin du blob chiffré sur disque, ne doit
// jamais apparaître en clair dans la base SQLite locale, voir
// docs/powersync-sync-streams.yaml). etat_des_lieux_piece_type et
// etat_des_lieux_piece_numero restent présents bien que toujours null
// pour l'instant : la branche entite_type = 'etat_des_lieux' n'est pas
// encore couverte par la requête (domaine État des lieux pas encore
// traité, voir docs/backlog.md).
const documents = new Table({
  entite_type: column.text,
  entite_id: column.text,
  categorie: column.text,
  statut: column.text,
  date_expiration: column.text,
  nom_fichier: column.text,
  mime_type: column.text,
  taille_octets: column.integer,
  etat_des_lieux_piece_type: column.text,
  etat_des_lieux_piece_numero: column.integer,
  updated_at: column.text
});

// risque_present (boolean côté Postgres) mappé en column.integer : pas de
// type booléen natif dans le SDK PowerSync (SQLite stocke un booléen
// comme un entier 0/1) — premier cas de ce type dans ce chantier.
const diagnostics = new Table({
  document_id: column.text,
  type: column.text,
  classe_dpe: column.text,
  depenses_theoriques_chauffage: column.real,
  risque_present: column.integer,
  updated_at: column.text
});

// Domaine État des lieux (12 tables). nouvelle_adresse_locataire incluse
// (cohérent avec locataires.adresse déjà accepté). date_entree/
// date_sortie en column.text comme toutes les colonnes date de ce
// chantier (AppSchema PowerSync n'a pas de type date dédié).
const etats_des_lieux = new Table({
  bail_id: column.text,
  date_entree: column.text,
  date_sortie: column.text,
  nouvelle_adresse_locataire: column.text,
  updated_at: column.text
});

// Mono-instance (unique sur etat_des_lieux_id côté Postgres — non
// représenté ici, AppSchema ne porte pas de contraintes). Toutes les
// colonnes *_description incluses (contenu de fond du modèle Word réel).
const etat_des_lieux_piece_entree = new Table({
  etat_des_lieux_id: column.text,
  porte_description: column.text,
  porte_etat_entree: column.text,
  porte_etat_sortie: column.text,
  sonnette_description: column.text,
  sonnette_etat_entree: column.text,
  sonnette_etat_sortie: column.text,
  mur_description: column.text,
  mur_etat_entree: column.text,
  mur_etat_sortie: column.text,
  sol_description: column.text,
  sol_etat_entree: column.text,
  sol_etat_sortie: column.text,
  vitrage_volets_description: column.text,
  vitrage_volets_etat_entree: column.text,
  vitrage_volets_etat_sortie: column.text,
  plafond_description: column.text,
  plafond_etat_entree: column.text,
  plafond_etat_sortie: column.text,
  eclairage_description: column.text,
  eclairage_etat_entree: column.text,
  eclairage_etat_sortie: column.text,
  prises_description: column.text,
  prises_etat_entree: column.text,
  prises_etat_sortie: column.text,
  prises_nombre: column.integer,
  updated_at: column.text
});

// Mono-instance. Même base que piece_entree sans porte_*/sonnette_*.
const etat_des_lieux_piece_sejour = new Table({
  etat_des_lieux_id: column.text,
  mur_description: column.text,
  mur_etat_entree: column.text,
  mur_etat_sortie: column.text,
  sol_description: column.text,
  sol_etat_entree: column.text,
  sol_etat_sortie: column.text,
  vitrage_volets_description: column.text,
  vitrage_volets_etat_entree: column.text,
  vitrage_volets_etat_sortie: column.text,
  plafond_description: column.text,
  plafond_etat_entree: column.text,
  plafond_etat_sortie: column.text,
  eclairage_description: column.text,
  eclairage_etat_entree: column.text,
  eclairage_etat_sortie: column.text,
  prises_description: column.text,
  prises_etat_entree: column.text,
  prises_etat_sortie: column.text,
  prises_nombre: column.integer,
  updated_at: column.text
});

// Mono-instance. Base de piece_sejour + placards/evier/plaques_cuisson/
// hotte/electromenager (ce dernier sans colonnes d'état associées).
const etat_des_lieux_piece_cuisine = new Table({
  etat_des_lieux_id: column.text,
  mur_description: column.text,
  mur_etat_entree: column.text,
  mur_etat_sortie: column.text,
  sol_description: column.text,
  sol_etat_entree: column.text,
  sol_etat_sortie: column.text,
  vitrage_volets_description: column.text,
  vitrage_volets_etat_entree: column.text,
  vitrage_volets_etat_sortie: column.text,
  plafond_description: column.text,
  plafond_etat_entree: column.text,
  plafond_etat_sortie: column.text,
  eclairage_description: column.text,
  eclairage_etat_entree: column.text,
  eclairage_etat_sortie: column.text,
  prises_description: column.text,
  prises_etat_entree: column.text,
  prises_etat_sortie: column.text,
  prises_nombre: column.integer,
  placards_description: column.text,
  placards_etat_entree: column.text,
  placards_etat_sortie: column.text,
  evier_description: column.text,
  evier_etat_entree: column.text,
  evier_etat_sortie: column.text,
  plaques_cuisson_description: column.text,
  plaques_cuisson_etat_entree: column.text,
  plaques_cuisson_etat_sortie: column.text,
  hotte_description: column.text,
  hotte_etat_entree: column.text,
  hotte_etat_sortie: column.text,
  electromenager_description: column.text,
  updated_at: column.text
});

// Mono-instance. Relevés de compteurs — decimal(10,2) côté Postgres
// mappé en column.real.
const etat_des_lieux_compteurs = new Table({
  etat_des_lieux_id: column.text,
  electricite_numero_compteur_entree: column.text,
  electricite_numero_compteur_sortie: column.text,
  electricite_releve_hp_entree: column.real,
  electricite_releve_hp_sortie: column.real,
  electricite_releve_hc_entree: column.real,
  electricite_releve_hc_sortie: column.real,
  electricite_ancien_occupant_entree: column.real,
  electricite_ancien_occupant_sortie: column.real,
  gaz_numero_compteur_entree: column.text,
  gaz_numero_compteur_sortie: column.text,
  gaz_releve_entree: column.real,
  gaz_releve_sortie: column.real,
  eau_releve_froide_entree: column.real,
  eau_releve_froide_sortie: column.real,
  eau_releve_chaude_entree: column.real,
  eau_releve_chaude_sortie: column.real,
  updated_at: column.text
});

// Multi-instance, unique sur (etat_des_lieux_id, numero) côté Postgres —
// 1 à 3 chambres.
const etat_des_lieux_pieces_chambre = new Table({
  etat_des_lieux_id: column.text,
  numero: column.integer,
  mur_description: column.text,
  mur_etat_entree: column.text,
  mur_etat_sortie: column.text,
  sol_description: column.text,
  sol_etat_entree: column.text,
  sol_etat_sortie: column.text,
  vitrage_volets_description: column.text,
  vitrage_volets_etat_entree: column.text,
  vitrage_volets_etat_sortie: column.text,
  plafond_description: column.text,
  plafond_etat_entree: column.text,
  plafond_etat_sortie: column.text,
  eclairage_description: column.text,
  eclairage_etat_entree: column.text,
  eclairage_etat_sortie: column.text,
  prises_description: column.text,
  prises_etat_entree: column.text,
  prises_etat_sortie: column.text,
  prises_nombre: column.integer,
  updated_at: column.text
});

// Multi-instance, unique sur (etat_des_lieux_id, numero) — 1 à 2 salles
// de bain. Base de pieces_chambre + lavabo/baignoire.
const etat_des_lieux_pieces_salle_de_bain = new Table({
  etat_des_lieux_id: column.text,
  numero: column.integer,
  mur_description: column.text,
  mur_etat_entree: column.text,
  mur_etat_sortie: column.text,
  sol_description: column.text,
  sol_etat_entree: column.text,
  sol_etat_sortie: column.text,
  vitrage_volets_description: column.text,
  vitrage_volets_etat_entree: column.text,
  vitrage_volets_etat_sortie: column.text,
  plafond_description: column.text,
  plafond_etat_entree: column.text,
  plafond_etat_sortie: column.text,
  eclairage_description: column.text,
  eclairage_etat_entree: column.text,
  eclairage_etat_sortie: column.text,
  prises_description: column.text,
  prises_etat_entree: column.text,
  prises_etat_sortie: column.text,
  prises_nombre: column.integer,
  lavabo_description: column.text,
  lavabo_etat_entree: column.text,
  lavabo_etat_sortie: column.text,
  baignoire_description: column.text,
  baignoire_etat_entree: column.text,
  baignoire_etat_sortie: column.text,
  updated_at: column.text
});

// Multi-instance, unique sur (etat_des_lieux_id, numero) — 1 à 2 WC. Base
// de pieces_chambre + lavabo/wc (la cuvette, distincte du lavabo).
const etat_des_lieux_pieces_wc = new Table({
  etat_des_lieux_id: column.text,
  numero: column.integer,
  mur_description: column.text,
  mur_etat_entree: column.text,
  mur_etat_sortie: column.text,
  sol_description: column.text,
  sol_etat_entree: column.text,
  sol_etat_sortie: column.text,
  vitrage_volets_description: column.text,
  vitrage_volets_etat_entree: column.text,
  vitrage_volets_etat_sortie: column.text,
  plafond_description: column.text,
  plafond_etat_entree: column.text,
  plafond_etat_sortie: column.text,
  eclairage_description: column.text,
  eclairage_etat_entree: column.text,
  eclairage_etat_sortie: column.text,
  prises_description: column.text,
  prises_etat_entree: column.text,
  prises_etat_sortie: column.text,
  prises_nombre: column.integer,
  lavabo_description: column.text,
  lavabo_etat_entree: column.text,
  lavabo_etat_sortie: column.text,
  wc_description: column.text,
  wc_etat_entree: column.text,
  wc_etat_sortie: column.text,
  updated_at: column.text
});

// Multi-instance, unique sur (etat_des_lieux_id, numero) — 1 à 2
// emplacements libres. libelle inclus (contenu de fond).
const etat_des_lieux_pieces_autre = new Table({
  etat_des_lieux_id: column.text,
  numero: column.integer,
  libelle: column.text,
  mur_description: column.text,
  mur_etat_entree: column.text,
  mur_etat_sortie: column.text,
  sol_description: column.text,
  sol_etat_entree: column.text,
  sol_etat_sortie: column.text,
  vitrage_volets_description: column.text,
  vitrage_volets_etat_entree: column.text,
  vitrage_volets_etat_sortie: column.text,
  plafond_description: column.text,
  plafond_etat_entree: column.text,
  plafond_etat_sortie: column.text,
  eclairage_description: column.text,
  eclairage_etat_entree: column.text,
  eclairage_etat_sortie: column.text,
  prises_description: column.text,
  prises_etat_entree: column.text,
  prises_etat_sortie: column.text,
  prises_nombre: column.integer,
  updated_at: column.text
});

// Multi-instance, AUCUNE contrainte d'unicité côté Postgres (upsert par
// id explicite côté service). commentaire volontairement absent — EXCLU
// du Sync Stream (texte libre annexe, même motif que
// versements.reference_rapprochement/remboursements.commentaire).
const etat_des_lieux_cles = new Table({
  etat_des_lieux_id: column.text,
  type_cle: column.text,
  libelle_autre: column.text,
  nombre_entree: column.integer,
  nombre_sortie: column.integer,
  updated_at: column.text
});

// Multi-instance, AUCUNE contrainte d'unicité côté Postgres (même
// situation que cles). commentaire EXCLU (même motif).
const etat_des_lieux_equipements_divers = new Table({
  etat_des_lieux_id: column.text,
  libelle: column.text,
  nombre_entree: column.integer,
  etat_entree: column.text,
  nombre_sortie: column.integer,
  etat_sortie: column.text,
  updated_at: column.text
});

// Multi-instance, unique sur (etat_des_lieux_id, element_id) côté
// Postgres — contrairement à cles/equipements_divers, cette table a bien
// une contrainte d'unicité DB. commentaire EXCLU (même motif que
// cles/equipements_divers).
const etat_des_lieux_inventaire = new Table({
  etat_des_lieux_id: column.text,
  element_id: column.text,
  nombre_entree: column.integer,
  etat_entree: column.text,
  nombre_sortie: column.integer,
  etat_sortie: column.text,
  updated_at: column.text
});

export const AppSchema = new Schema({
  scis,
  immeubles,
  appartements,
  equipements,
  baux,
  garants,
  bail_locataires,
  locataires,
  paiements,
  versements,
  remboursements,
  parametres_alertes,
  indices_irl,
  elements_inventaire_meuble,
  documents,
  diagnostics,
  etats_des_lieux,
  etat_des_lieux_piece_entree,
  etat_des_lieux_piece_sejour,
  etat_des_lieux_piece_cuisine,
  etat_des_lieux_compteurs,
  etat_des_lieux_pieces_chambre,
  etat_des_lieux_pieces_salle_de_bain,
  etat_des_lieux_pieces_wc,
  etat_des_lieux_pieces_autre,
  etat_des_lieux_cles,
  etat_des_lieux_equipements_divers,
  etat_des_lieux_inventaire
});

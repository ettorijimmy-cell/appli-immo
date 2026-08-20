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
  diagnostics
});

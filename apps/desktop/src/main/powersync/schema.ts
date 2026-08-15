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

export const AppSchema = new Schema({ scis, immeubles, appartements, equipements });

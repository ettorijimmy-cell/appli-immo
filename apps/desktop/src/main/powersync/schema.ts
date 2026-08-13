import { column, Schema, Table } from "@powersync/node";

// Une seule table pour l'instant (test minimal, voir docs/backlog.md,
// chantier Hébergement backend/PowerSync) — étendue table par table dans
// l'ordre de dépendance des Modules, jamais en bloc. `id` est généré
// automatiquement par PowerSync (colonne text), pas déclaré ici.
const scis = new Table({
  nom: column.text,
  regime_fiscal: column.text,
  statut: column.text
});

export const AppSchema = new Schema({ scis });

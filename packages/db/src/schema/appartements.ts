import { decimal, integer, pgEnum, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { auditColumns } from "./columns.helpers";
import { immeubles } from "./immeubles";

// "T5+" remplacé par des valeurs précises T5/T6 (confirmé : aucun
// appartement réel en base n'utilisait "T5+" au moment du changement,
// migration directe sans reclassement nécessaire).
export const appartementTypeEnum = pgEnum("appartement_type", ["T1", "T2", "T3", "T4", "T5", "T6"]);
export const appartementStatutEnum = pgEnum("appartement_statut", [
  "vacant",
  "loue",
  "travaux",
  "archive"
]);
// Modalités de production (chauffage / eau chaude sanitaire) — mentions du
// contrat-type (décret n° 2015-587), au niveau du lot (contrairement à
// type_habitat/regime_juridique qui sont au niveau immeuble) : un
// chauffage individuel peut coexister avec un chauffage collectif dans le
// même bâtiment selon les lots (docs/backlog.md, section "Édition d'un
// bail").
export const appartementModeProductionEnum = pgEnum("appartement_mode_production", [
  "individuel",
  "collectif"
]);
// Énergie du chauffage/eau chaude — confirmé au niveau du lot, pas de
// l'immeuble : peut varier d'un logement à l'autre même dans un
// immeuble à chauffage individuel (module État des lieux, décision du
// 2026-08-03). Distinct de mode_chauffage/mode_eau_chaude ci-dessus
// (individuel/collectif), qui répond à une question différente.
export const appartementTypeEnergieEnum = pgEnum("appartement_type_energie", [
  "electrique",
  "gaz",
  "les_deux"
]);

export const appartements = pgTable("appartements", {
  ...auditColumns,
  immeubleId: uuid("immeuble_id")
    .notNull()
    .references(() => immeubles.id),
  numero: text("numero").notNull(),
  type: appartementTypeEnum("type").notNull(),
  surface: decimal("surface", { precision: 6, scale: 2 }),
  loyerReference: decimal("loyer_reference", { precision: 10, scale: 2 }),
  // Mentions du contrat-type non couvertes par les champs ci-dessus :
  // `type` (T1-T6) reste une catégorie commerciale, distincte du décompte
  // légal de pièces principales exigé dans le bail.
  identifiantFiscal: text("identifiant_fiscal"),
  nombrePiecesPrincipales: integer("nombre_pieces_principales"),
  modeChauffage: appartementModeProductionEnum("mode_chauffage"),
  modeEauChaude: appartementModeProductionEnum("mode_eau_chaude"),
  typeEnergie: appartementTypeEnergieEnum("type_energie"),
  // Texte libre, mentions du modèle de bail — équipement de la cuisine
  // (bail meublé notamment) et dépendances/annexes (cave, parking...).
  equipementCuisine: text("equipement_cuisine"),
  dependancesAnnexes: text("dependances_annexes"),
  // 'vacant' par défaut : un appartement nouvellement créé n'a pas encore
  // de bail actif (règle de transition automatique vacant -> loue au
  // Module 3).
  statut: appartementStatutEnum("statut").notNull().default("vacant")
});

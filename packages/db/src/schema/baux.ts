import { date, decimal, pgEnum, pgTable, uuid } from "drizzle-orm/pg-core";
import { appartements } from "./appartements";
import { auditColumns } from "./columns.helpers";

export const bailTypeBailEnum = pgEnum("bail_type_bail", ["vide", "meuble"]);
// brouillon -> actif -> (preavis) -> resilie -> archive. Le passage à "actif"
// et "resilie" déclenche la transition automatique du statut de
// l'appartement (packages/core, apps/backend/src/baux/baux.service.ts) —
// jamais via une modification générique de `statut`, qui n'existe pas dans
// UpdateBailDto.
export const bailStatutEnum = pgEnum("bail_statut", [
  "brouillon",
  "actif",
  "preavis",
  "resilie",
  "archive"
]);

export const baux = pgTable("baux", {
  ...auditColumns,
  appartementId: uuid("appartement_id")
    .notNull()
    .references(() => appartements.id),
  typeBail: bailTypeBailEnum("type_bail").notNull(),
  statut: bailStatutEnum("statut").notNull().default("brouillon"),
  // Pré-rempli depuis appartements.loyer_reference à la création si non
  // fourni explicitement (packages/core, preremplirLoyerBail) — reste
  // modifiable ensuite, un bail peut différer de la référence.
  loyerMensuel: decimal("loyer_mensuel", { precision: 10, scale: 2 }),
  depotGarantie: decimal("depot_garantie", { precision: 10, scale: 2 }),
  dateDebut: date("date_debut").notNull(),
  dateFin: date("date_fin")
});

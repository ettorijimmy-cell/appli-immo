import { boolean, decimal, pgEnum, pgTable, uuid } from "drizzle-orm/pg-core";
import { auditColumns } from "./columns.helpers";
import { documents } from "./documents";

// 1:1 avec documents (pas un nouveau lien polymorphe : celui de documents
// couvre déjà "immeuble" et "appartement", suffisant pour rattacher un
// diagnostic soit à tout le bâtiment (ERP, souvent) soit à un lot précis
// (DPE/CREP, toujours) — docs/backlog.md, section "Édition d'un bail".
// Pas de ligne ici pour l'élec/gaz : vérifié sur le texte exact du
// contrat-type, seul le DPE cite une valeur de résultat dans le corps du
// bail ("niveau de performance du logement : [classe...]"), l'élec/gaz ne
// fait que renvoyer à l'annexe — documents.dateExpiration suffit pour
// cette seule mention.
export const diagnosticTypeEnum = pgEnum("diagnostic_type", ["dpe", "crep_plomb", "erp"]);
export const diagnosticClasseDpeEnum = pgEnum("diagnostic_classe_dpe", [
  "A",
  "B",
  "C",
  "D",
  "E",
  "F",
  "G"
]);

export const diagnostics = pgTable("diagnostics", {
  ...auditColumns,
  documentId: uuid("document_id")
    .notNull()
    .references(() => documents.id),
  type: diagnosticTypeEnum("type").notNull(),
  // Rempli uniquement si type="dpe" — le contrat-type cite explicitement
  // la classe dans son corps de texte.
  classeDpe: diagnosticClasseDpeEnum("classe_dpe"),
  depensesTheoriquesChauffage: decimal("depenses_theoriques_chauffage", {
    precision: 10,
    scale: 2
  }),
  // Rempli uniquement si type="crep_plomb" ou "erp" — les deux sont de
  // nature binaire (risque détecté ou non), contrairement au DPE.
  risquePresent: boolean("risque_present")
});

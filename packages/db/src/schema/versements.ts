import { date, decimal, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { auditColumns } from "./columns.helpers";
import { paiementModeEnum, paiements } from "./paiements";

// Un `paiement` reste "ce qui est dû à une échéance" ; un `versement`
// devient "un encaissement réel", plusieurs par paiement — y compris
// plusieurs le même jour (docs/data-dictionary.md, section "versements &
// remboursements"). Pas de `statut` propre : une fois enregistré, c'est un
// fait ; s'il est faux, on l'archive et on en recrée un correct, jamais une
// distinction paye/impaye qui n'a pas de sens à ce niveau.
export const versements = pgTable("versements", {
  ...auditColumns,
  paiementId: uuid("paiement_id")
    .notNull()
    .references(() => paiements.id),
  montant: decimal("montant", { precision: 10, scale: 2 }).notNull(),
  dateVersement: date("date_versement").notNull(),
  mode: paiementModeEnum("mode").notNull(),
  // Renseigné uniquement lors d'une confirmation de rapprochement CSV — le
  // libellé de la ligne de relevé retenue POUR CE versement précis (chaque
  // versement peut provenir d'un import différent).
  referenceRapprochement: text("reference_rapprochement")
});

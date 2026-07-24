import { pgTable, text, uuid } from "drizzle-orm/pg-core";
import { auditColumns } from "./columns.helpers";
import { scis } from "./scis";

export const comptesBancairesSci = pgTable("comptes_bancaires_sci", {
  ...auditColumns,
  sciId: uuid("sci_id")
    .notNull()
    .references(() => scis.id),
  ibanChiffre: text("iban_chiffre").notNull(),
  bicChiffre: text("bic_chiffre").notNull()
});

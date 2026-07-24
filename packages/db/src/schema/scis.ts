import { pgEnum, pgTable, text } from "drizzle-orm/pg-core";
import { auditColumns } from "./columns.helpers";

export const sciRegimeFiscalEnum = pgEnum("sci_regime_fiscal", ["IS", "IR"]);
export const sciStatutEnum = pgEnum("sci_statut", ["active", "archive"]);

export const scis = pgTable("scis", {
  ...auditColumns,
  nom: text("nom").notNull(),
  regimeFiscal: sciRegimeFiscalEnum("regime_fiscal").notNull(),
  formeJuridique: text("forme_juridique"),
  siret: text("siret"),
  statut: sciStatutEnum("statut").notNull().default("active")
});

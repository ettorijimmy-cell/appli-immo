import { pgTable, text, uuid } from "drizzle-orm/pg-core";
import { auditColumns } from "./columns.helpers";
import { depenseCategorieEnum } from "./depense";
import { organisations } from "./organisations";

// Module Charges et fiscalité, Étape 2 (2026-09-11, docs/backlog.md) :
// règle mot-clé -> catégorie gérée par l'utilisateur lui-même via un
// écran dédié (pas un script de seed — Jimmy en ajoute au fil de l'usage
// réel de l'import CSV). motCle est comparé au libellé d'une ligne de
// relevé via libelleContient (packages/core) — correspondance insensible
// à la casse/aux accents/à la ponctuation. Ne fait QUE présélectionner
// une catégorie dans le formulaire existant (ImportCsvDepensesView) :
// si plusieurs règles correspondent à un même libellé, aucune suggestion
// n'est faite (suggererCategorie, packages/core) — jamais de choix
// arbitraire entre deux règles candidates.
export const regleCategorisation = pgTable("regle_categorisation", {
  ...auditColumns,
  motCle: text("mot_cle").notNull(),
  categorie: depenseCategorieEnum("categorie").notNull(),
  // Scoping multi-tenant direct, même principe que depense.organisationId
  // — résolu depuis l'organisation de l'utilisateur courant à la création,
  // jamais transmis par le client.
  organisationId: uuid("organisation_id")
    .notNull()
    .references(() => organisations.id)
});

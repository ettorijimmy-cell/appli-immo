import { decimal, integer, pgTable, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { auditColumns } from "./columns.helpers";
import { bien } from "./bien";
import { organisations } from "./organisations";

// Module Charges et fiscalité, Étape 4 (2072-S-A1-SD, cadre VII).
// Uniquement les lignes de l'Annexe 1 qu'aucune règle fiscale simple ne
// permet de dériver des données déjà trackées (subventions, indemnités
// d'éviction, régularisations d'années antérieures, déduction spécifique,
// rémunérations aux associés, parts dans d'autres sociétés) — jamais une
// tentative de deviner leur calcul (docs/backlog.md, note du 2026-09-06).
// Une ligne par bien et par année civile : l'Annexe 1 est structurée par
// immeuble, jamais par SCI directement (l'agrégat par SCI est recalculé à
// la lecture, jamais stocké).
export const annexe1SaisieManuelle = pgTable(
  "annexe1_saisie_manuelle",
  {
    ...auditColumns,
    bienId: uuid("bien_id")
      .notNull()
      .references(() => bien.id),
    annee: integer("annee").notNull(),
    ligne2: decimal("ligne_2", { precision: 10, scale: 2 }),
    ligne3: decimal("ligne_3", { precision: 10, scale: 2 }),
    ligne4: decimal("ligne_4", { precision: 10, scale: 2 }),
    ligne9Bis: decimal("ligne_9_bis", { precision: 10, scale: 2 }),
    ligne10: decimal("ligne_10", { precision: 10, scale: 2 }),
    ligne11: decimal("ligne_11", { precision: 10, scale: 2 }),
    ligne14: decimal("ligne_14", { precision: 10, scale: 2 }),
    ligne15: decimal("ligne_15", { precision: 10, scale: 2 }),
    ligne19: decimal("ligne_19", { precision: 10, scale: 2 }),
    ligne20: decimal("ligne_20", { precision: 10, scale: 2 }),
    ligne22: decimal("ligne_22", { precision: 10, scale: 2 }),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id)
  },
  (table) => [uniqueIndex("annexe1_saisie_manuelle_bien_annee_unique").on(table.bienId, table.annee)]
);

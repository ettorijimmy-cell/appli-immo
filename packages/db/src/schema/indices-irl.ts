import { decimal, integer, pgTable, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { uuidv7 } from "uuidv7";

/**
 * Indice de référence des loyers (IRL), série INSEE BDM 001515333 — voir
 * docs/backlog.md, section "Édition d'un bail". Table de référence,
 * alimentée exclusivement par la tâche planifiée
 * (IndicesIrlJobService) : pas de colonnes d'audit standard
 * (created_at/updated_by/version/archived_at), même principe que
 * journal_audit — une valeur IRL publiée n'est jamais modifiée après coup,
 * seule une nouvelle ligne (nouveau trimestre) peut être ajoutée.
 *
 * `date_recuperation` sert de signal de fraîcheur : la génération du bail
 * bloque si la dernière ligne connue date de plus de 4 mois (l'IRL étant
 * trimestriel, un tel écart signale un problème de rafraîchissement du
 * job, pas une absence légitime de nouvelle publication).
 */
export const indicesIrl = pgTable(
  "indices_irl",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    annee: integer("annee").notNull(),
    trimestre: integer("trimestre").notNull(),
    valeur: decimal("valeur", { precision: 6, scale: 2 }).notNull(),
    dateRecuperation: timestamp("date_recuperation", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [uniqueIndex("indices_irl_annee_trimestre_unique").on(table.annee, table.trimestre)]
);

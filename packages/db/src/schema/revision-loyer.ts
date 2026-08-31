import { date, decimal, integer, pgTable, uuid } from "drizzle-orm/pg-core";
import { auditColumns } from "./columns.helpers";
import { baux } from "./baux";
import { organisations } from "./organisations";
import { tache } from "./tache";

// Historique des révisions de loyer réellement appliquées (Module Tâches,
// Étape 5, docs/backlog.md) — comble le trou documenté dans
// docs/data-dictionary.md ("Tables prévues mais non modélisées : la seule
// valeur courante baux.loyerMensuel est stockée, sans trace des révisions
// passées"). Une ligne par révision appliquée via
// TachesService.appliquerRevision, jamais réécrite ensuite (pas de
// update() prévu — une révision appliquée est un fait historique).
export const revisionLoyer = pgTable("revision_loyer", {
  ...auditColumns,
  bailId: uuid("bail_id")
    .notNull()
    .references(() => baux.id),
  // Nullable : une révision doit pouvoir être tracée même si la tâche qui
  // l'a proposée a depuis été archivée/supprimée — l'historique financier
  // ne doit jamais dépendre du cycle de vie d'une tâche.
  tacheId: uuid("tache_id").references(() => tache.id),
  dateEffet: date("date_effet").notNull(),
  loyerAvant: decimal("loyer_avant", { precision: 10, scale: 2 }).notNull(),
  loyerApres: decimal("loyer_apres", { precision: 10, scale: 2 }).notNull(),
  trimestreReference: integer("trimestre_reference").notNull(),
  // Année courante utilisée pour le calcul (indice_reference_valeur porte
  // sur cette année, indice_precedent_valeur sur année_reference - 1, même
  // trimestre).
  anneeReference: integer("annee_reference").notNull(),
  indiceReferenceValeur: decimal("indice_reference_valeur", { precision: 6, scale: 2 }).notNull(),
  indicePrecedentValeur: decimal("indice_precedent_valeur", { precision: 6, scale: 2 }).notNull(),
  organisationId: uuid("organisation_id")
    .notNull()
    .references(() => organisations.id)
});

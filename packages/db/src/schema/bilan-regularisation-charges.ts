import { date, decimal, pgEnum, pgTable, uuid } from "drizzle-orm/pg-core";
import { auditColumns } from "./columns.helpers";
import { baux } from "./baux";
import { organisations } from "./organisations";
import { tache } from "./tache";

// Miroir de SensBilanRegularisation (packages/core/src/charges/
// calculer-bilan-regularisation.ts) — packages/db ne dépend jamais de core
// (voir CLAUDE.md), ces 3 valeurs sont donc dupliquées ici plutôt
// qu'importées, à garder synchronisées si ce type évolue.
export const sensBilanRegularisationEnum = pgEnum("sens_bilan_regularisation", [
  "faveur_locataire",
  "faveur_proprietaire",
  "equilibre"
]);

// Module Régularisation des charges, Sous-commit F (2026-10-05) — comble le
// trou documenté au Sous-commit C : RegularisationChargesService.
// calculerBilanPourBail était purement un calcul, jamais persisté ;
// seule la tâche de rappel (type='regularisation_charges') laissait une
// trace, et uniquement quand sens='faveur_proprietaire'. Une ligne par
// calcul effectué (manuel ou automatique), quel que soit le sens — jamais
// réécrite ensuite (même principe que revision_loyer : un calcul effectué
// est un fait historique, pas de update() prévu). C'est ce qui rend
// « le bilan existant le plus récent » et son historique interrogeables
// pour TOUS les bilans, pas seulement ceux qui ont généré une tâche.
export const bilanRegularisationCharges = pgTable("bilan_regularisation_charges", {
  ...auditColumns,
  bailId: uuid("bail_id")
    .notNull()
    .references(() => baux.id),
  periodeDebut: date("periode_debut").notNull(),
  periodeFin: date("periode_fin").notNull(),
  provisionsRecues: decimal("provisions_recues", { precision: 10, scale: 2 }).notNull(),
  chargesReelles: decimal("charges_reelles", { precision: 10, scale: 2 }).notNull(),
  solde: decimal("solde", { precision: 10, scale: 2 }).notNull(),
  sens: sensBilanRegularisationEnum("sens").notNull(),
  // Renseigné UNIQUEMENT quand sens='faveur_proprietaire' ET qu'une tâche
  // de rappel a été créée ou existait déjà pour cette période — jamais pour
  // faveur_locataire/equilibre (TachesJobService.genererTacheRegularisation
  // SiNecessaire ne crée de tâche que dans ce cas). Nullable comme
  // revision_loyer.tacheId : l'historique financier ne doit jamais dépendre
  // du cycle de vie d'une tâche.
  tacheId: uuid("tache_id").references(() => tache.id),
  organisationId: uuid("organisation_id")
    .notNull()
    .references(() => organisations.id)
});

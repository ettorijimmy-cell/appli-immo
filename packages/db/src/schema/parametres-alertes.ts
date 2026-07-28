import { integer, pgTable, uniqueIndex } from "drizzle-orm/pg-core";
import { alerteTypeEnum } from "./alertes";
import { auditColumns } from "./columns.helpers";

// Une ligne par type d'alerte, créée avec une valeur par défaut au premier
// accès si absente (AlertesConfigService) plutôt que par une migration de
// données écrite à la main (CLAUDE.md : les migrations Drizzle ne portent
// que le schéma, jamais de données).
export const parametresAlertes = pgTable(
  "parametres_alertes",
  {
    ...auditColumns,
    type: alerteTypeEnum("type").notNull(),
    // Sens dépendant du type (docs/data-dictionary.md) : nombre de jours
    // AVANT l'échéance pour bail_fin_proche/document_expire_proche/
    // entretien_equipement, nombre de jours de délai de grâce APRÈS
    // date_echeance pour impaye. document_expire n'utilise aucun seuil
    // (statut déjà expiré, pas de notion d'anticipation).
    seuilJoursAvant: integer("seuil_jours_avant").notNull()
  },
  (table) => [uniqueIndex("parametres_alertes_type_unique").on(table.type)]
);

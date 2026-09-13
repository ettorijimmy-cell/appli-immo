import { pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { auditColumns } from "./columns.helpers";
import { organisations } from "./organisations";

// Module Calendrier d'interventions (2026-09-15). Une seule ligne par
// organisation (contrainte unique sur organisation_id) — régénérer le
// jeton met à jour la ligne existante plutôt que d'en créer une
// deuxième, révoquant implicitement l'ancienne URL (mettreAJourAvecAudit
// remplace la valeur de `jeton`, jamais de suppression physique).
// `jeton` : crypto.randomBytes(32).toString("hex"), stocké en clair —
// ce n'est pas un mot de passe (aucun hash à vérifier), c'est une URL non
// listée à traiter comme un secret côté transport (voir
// docs/data-dictionary.md).
export const calendrierAbonnement = pgTable(
  "calendrier_abonnement",
  {
    ...auditColumns,
    jeton: text("jeton").notNull().unique(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id)
  },
  (table) => [uniqueIndex("calendrier_abonnement_organisation_id_unique").on(table.organisationId)]
);

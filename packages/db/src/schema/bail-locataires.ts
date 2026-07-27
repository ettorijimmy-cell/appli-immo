import { pgEnum, pgTable, uuid } from "drizzle-orm/pg-core";
import { baux } from "./baux";
import { auditColumns } from "./columns.helpers";
import { locataires } from "./locataires";

// Table de liaison pour la colocation : un bail peut avoir plusieurs
// locataires, chacun avec un rôle. Retirer un locataire d'un bail archive
// la ligne de liaison (archivedAt), jamais de suppression physique.
export const bailLocataireRoleEnum = pgEnum("bail_locataire_role", ["titulaire", "colocataire"]);

export const bailLocataires = pgTable("bail_locataires", {
  ...auditColumns,
  bailId: uuid("bail_id")
    .notNull()
    .references(() => baux.id),
  locataireId: uuid("locataire_id")
    .notNull()
    .references(() => locataires.id),
  role: bailLocataireRoleEnum("role").notNull()
});

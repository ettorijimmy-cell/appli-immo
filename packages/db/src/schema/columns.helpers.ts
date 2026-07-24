import { integer, timestamp, uuid } from "drizzle-orm/pg-core";
import { uuidv7 } from "uuidv7";

/**
 * Colonnes obligatoires sur toute table métier (CLAUDE.md) : UUID v7 en clé
 * primaire, traçabilité création/modification, versionnage optimiste,
 * archivage (jamais de suppression physique).
 *
 * `updatedBy` n'est volontairement pas une contrainte de clé étrangère :
 * la référencer vers `utilisateurs` créerait une dépendance circulaire avec
 * les tables qui, comme `utilisateurs`, portent elles-mêmes ces colonnes.
 */
export const auditColumns = {
  id: uuid("id")
    .primaryKey()
    .$defaultFn(() => uuidv7()),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid("updated_by"),
  version: integer("version").notNull().default(1),
  archivedAt: timestamp("archived_at", { withTimezone: true })
};

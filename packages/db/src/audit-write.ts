import { eq, sql, type AnyColumn } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import type { Database } from "./client";

interface TableAvecAudit extends PgTable {
  id: AnyColumn;
  version: AnyColumn;
  updatedAt: AnyColumn;
  updatedBy: AnyColumn;
}

/**
 * Point d'écriture unique pour toute mise à jour d'une table métier :
 * timbre systématiquement updated_at / updated_by / version (incrémenté de
 * façon atomique côté SQL, jamais lu puis réécrit) sans que chaque service
 * ait à y penser. Introduit après le constat, au Module 5, qu'aucune des
 * 22 écritures existantes (9 services) ne posait version/updated_by — voir
 * docs/backlog.md.
 *
 * Accepte `db` ou une transaction (`tx` dans `db.transaction(async (tx) =>
 * ...)`) indifféremment : les deux exposent la même méthode `.update()`.
 *
 * `table as never` : Drizzle ne fournit pas de type public décrivant « une
 * PgTable qui possède au moins les colonnes id/version/updatedAt/updatedBy » ;
 * la sûreté de ce contournement de typage repose sur le fait que TOUTE table
 * métier passe par `...auditColumns` (packages/db/src/schema/columns.helpers.ts),
 * qui garantit la présence de ces quatre colonnes.
 */
export async function mettreAJourAvecAudit<T extends TableAvecAudit>(
  db: Pick<Database, "update">,
  table: T,
  id: string,
  valeurs: Record<string, unknown>,
  utilisateurId: string | null
) {
  return db
    .update(table)
    .set({
      ...valeurs,
      updatedAt: new Date(),
      updatedBy: utilisateurId,
      version: sql`${table.version} + 1`
    } as T["$inferInsert"])
    .where(eq(table.id, id))
    .returning();
}

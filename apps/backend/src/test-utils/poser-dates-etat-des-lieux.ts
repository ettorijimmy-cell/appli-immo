import { etatsDesLieux, type Database } from "db";
import { eq } from "drizzle-orm";

// Décision 11 (2026-11-06) : le PATCH ne pose plus dateEntree/dateSortie.
// Les tests qui ont besoin d'une date sans signature (génération du
// document, statut dérivé, données historiques saisies à la main avant
// cette décision) l'écrivent directement, comme une ligne déjà en base.
export async function poserDatesEtatDesLieux(
  db: Database,
  etatDesLieuxId: string,
  dates: { dateEntree?: string; dateSortie?: string }
): Promise<void> {
  await db.update(etatsDesLieux).set(dates).where(eq(etatsDesLieux.id, etatDesLieuxId));
}

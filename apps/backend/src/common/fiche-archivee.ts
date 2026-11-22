import { ConflictException, NotFoundException } from "@nestjs/common";
import { mettreAJourFicheNonArchiveeAvecAudit, type Database } from "db";
import { eq } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { dateDuJourParis } from "./date-paris";

// Fiches archivées (petites suites, décision 4 du 2026-11-22, et audit des
// petites suites, point 6 a/b) :
// - archiver une fiche déjà archivée → 409 « Déjà archivé le JJ/MM/AAAA. »
//   (date de l'archivage existant, jour de Paris), sans aucune écriture ;
// - modifier une fiche archivée → 409 « Cette fiche est archivée : elle ne
//   peut plus être modifiée. », sans aucune écriture.
// Le contrôle d'appartenance reste TOUJOURS avant (404 identique pour une
// fiche inexistante ou d'une autre organisation) : chaque service appelle
// d'abord son resoudre…AvecAppartenance(), puis exigerNonArchivee… sur la
// ligne lue, puis écrit avec archiverFiche()/modifierFiche(), dont l'UPDATE
// porte lui-même la condition `archived_at IS NULL` (course entre deux
// clics ou deux postes).

export const MESSAGE_FICHE_ARCHIVEE = "Cette fiche est archivée : elle ne peut plus être modifiée.";

// « annulé » pour l'annulation d'un versement (compléments du 2026-11-22
// soir) : son archivage est une annulation, « Déjà archivé » serait trompeur.
export type LibelleDejaFait = "archivé" | "annulé";

export function messageDejaArchive(archivedAt: Date, dejaFait: LibelleDejaFait = "archivé"): string {
  const [annee, mois, jour] = dateDuJourParis(archivedAt).split("-");
  return `Déjà ${dejaFait} le ${jour}/${mois}/${annee}.`;
}

interface LigneArchivable {
  archivedAt: Date | null;
}

// À appeler dans archive(), juste après le contrôle d'appartenance.
export function exigerNonArchiveePourArchiver(ligne: LigneArchivable, dejaFait: LibelleDejaFait = "archivé"): void {
  if (ligne.archivedAt) {
    throw new ConflictException(messageDejaArchive(ligne.archivedAt, dejaFait));
  }
}

// À appeler dans update() et les actions de modification, juste après le
// contrôle d'appartenance.
export function exigerNonArchiveePourModifier(ligne: LigneArchivable): void {
  if (ligne.archivedAt) {
    throw new ConflictException(MESSAGE_FICHE_ARCHIVEE);
  }
}

interface TableArchivable extends PgTable {
  id: PgColumn;
  version: PgColumn;
  updatedAt: PgColumn;
  updatedBy: PgColumn;
  archivedAt: PgColumn;
}

type Executeur = Pick<Database, "update" | "select">;

async function lireArchivedAt(db: Executeur, table: TableArchivable, id: string): Promise<Date | null | undefined> {
  const [ligne] = await db
    .select({ archivedAt: table.archivedAt })
    .from(table)
    .where(eq(table.id, id))
    .limit(1);
  return ligne ? (ligne.archivedAt as Date | null) : undefined;
}

// Archive la fiche si, et seulement si, elle n'est pas déjà archivée (condition
// dans l'UPDATE). Si l'UPDATE ne touche aucune ligne : 409 « Déjà archivé le … »
// (archivée entre-temps par un autre appel) ou 404 (ligne disparue).
export async function archiverFiche<T extends TableArchivable>(
  db: Executeur,
  table: T,
  id: string,
  valeurs: Record<string, unknown>,
  utilisateurId: string | null,
  messageIntrouvable: string,
  dejaFait: LibelleDejaFait = "archivé"
) {
  const [ligne] = await mettreAJourFicheNonArchiveeAvecAudit(
    db,
    table,
    id,
    { ...valeurs, archivedAt: new Date() },
    utilisateurId
  );
  if (ligne) {
    return ligne;
  }
  const archivedAt = await lireArchivedAt(db, table, id);
  if (archivedAt) {
    throw new ConflictException(messageDejaArchive(archivedAt, dejaFait));
  }
  throw new NotFoundException(messageIntrouvable);
}

// Modifie la fiche si, et seulement si, elle n'est pas archivée (condition
// dans l'UPDATE). Si l'UPDATE ne touche aucune ligne : 409 « Cette fiche est
// archivée … » (archivée entre-temps) ou 404 (ligne disparue).
export async function modifierFiche<T extends TableArchivable>(
  db: Executeur,
  table: T,
  id: string,
  valeurs: Record<string, unknown>,
  utilisateurId: string | null,
  messageIntrouvable: string
) {
  const [ligne] = await mettreAJourFicheNonArchiveeAvecAudit(db, table, id, valeurs, utilisateurId);
  if (ligne) {
    return ligne;
  }
  const archivedAt = await lireArchivedAt(db, table, id);
  if (archivedAt) {
    throw new ConflictException(MESSAGE_FICHE_ARCHIVEE);
  }
  throw new NotFoundException(messageIntrouvable);
}

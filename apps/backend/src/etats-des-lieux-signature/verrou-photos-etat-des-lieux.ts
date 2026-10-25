import { ConflictException } from "@nestjs/common";
import type { Database } from "db";
import { resoudrePhasesSigneesEtatDesLieux } from "./resoudre-phase-etat-des-lieux";

// Verrou des photos d'état des lieux (chantier Signatures, 2026-10-25) :
// fonction pure, importée directement par DocumentsService — jamais par un
// import de EtatsDesLieuxSignatureModule, pour ne créer AUCUNE dépendance
// de DocumentsModule vers EtatsDesLieuxModule (même principe que
// resoudrePhaseEtatDesLieuxCourante ci-contre, déjà utilisée ainsi).
//
// `db` typé `Pick<Database, "select">` : accepte indifféremment le client
// racine ou une transaction.

// Ajout (upload) : une fois la sortie signée, plus aucune photo ne peut
// être ajoutée à cet état des lieux, quelle que soit la phase qu'elle
// viserait. Avant la signature de sortie, l'ajout reste toujours permis :
// la phase posée automatiquement (resoudrePhaseEtatDesLieuxCourante) ne
// peut jamais valoir "entree" une fois celle-ci signée — aucun garde
// supplémentaire n'est donc nécessaire pour ce cas côté ajout.
export async function verifierAjoutPhotoAutorise(
  db: Pick<Database, "select">,
  etatDesLieuxId: string
): Promise<void> {
  const { sortieSignee } = await resoudrePhasesSigneesEtatDesLieux(db, etatDesLieuxId);
  if (sortieSignee) {
    throw new ConflictException(
      "Cet état des lieux est signé en sortie : plus aucune photo ne peut y être ajoutée."
    );
  }
}

// Archivage : une photo de la phase entrée ne peut plus être archivée une
// fois l'entrée signée ; aucune photo (entrée ou sortie) ne peut plus être
// archivée une fois la sortie signée. `phase` vient de la ligne `documents`
// existante (document.etatDesLieuxPhase) — jamais recalculée ici.
export async function verifierArchivagePhotoAutorise(
  db: Pick<Database, "select">,
  etatDesLieuxId: string,
  phase: "entree" | "sortie" | null
): Promise<void> {
  const { entreeSignee, sortieSignee } = await resoudrePhasesSigneesEtatDesLieux(db, etatDesLieuxId);
  if (sortieSignee) {
    throw new ConflictException(
      "Cet état des lieux est signé en sortie : plus aucune photo ne peut y être archivée."
    );
  }
  // Une photo sans phase (`null`) est nécessairement antérieure à l'ajout
  // de la colonne etat_des_lieux_phase (2026-10-24) — la fonctionnalité de
  // phase de sortie n'existait pas encore, donc une telle photo est
  // forcément une photo de la visite d'entrée. Traitée comme "entree",
  // jamais comme un cas à part qui échapperait au verrou.
  const phaseEffective = phase ?? "entree";
  if (phaseEffective === "entree" && entreeSignee) {
    throw new ConflictException(
      "La partie entrée de cet état des lieux est signée : ses photos ne peuvent plus être archivées."
    );
  }
}

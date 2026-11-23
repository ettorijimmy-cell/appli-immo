import type { Bail } from "../locataires/api";

// Commit 5b des petites suites : le remède « archivez d'abord le
// remboursement » (refus d'annuler un versement, d'archiver une échéance, de
// corriger un préavis) doit toujours être accessible depuis le desktop.

type RemboursementListe = { bailId: string; archivedAt: string | null };

// Section « Remboursements » de la fiche du bail : toujours sur un bail
// résilié (c'est là qu'on les crée) ; sur un autre statut (préavis surtout :
// le tableau de bord fait créer un remboursement du mois de fin dès que la
// date de fin est posée), dès qu'il existe au moins un remboursement actif,
// pour pouvoir l'archiver.
export function sectionRemboursementsVisible(
  statut: Bail["statut"],
  remboursements: readonly { archivedAt: string | null }[]
): boolean {
  return statut === "resilie" || remboursements.some((remboursement) => remboursement.archivedAt === null);
}

export interface RemboursementsDuBail<T> {
  lignes: T[];
  nbActifs: number;
}

// « Historique des baux » : remboursements regroupés par bail, dans l'ordre
// reçu. Archivés masqués sauf « Afficher les archivés » ; le compteur ne
// compte que les actifs. Un bail sans ligne visible n'a pas d'entrée (pas de
// bouton « Remboursements (N) »).
export function remboursementsParBail<T extends RemboursementListe>(
  remboursements: readonly T[],
  afficherArchives: boolean
): Map<string, RemboursementsDuBail<T>> {
  const parBail = new Map<string, RemboursementsDuBail<T>>();
  for (const remboursement of remboursements) {
    const actif = remboursement.archivedAt === null;
    if (!actif && !afficherArchives) {
      continue;
    }
    const entree = parBail.get(remboursement.bailId) ?? { lignes: [], nbActifs: 0 };
    entree.lignes.push(remboursement);
    if (actif) {
      entree.nbActifs += 1;
    }
    parBail.set(remboursement.bailId, entree);
  }
  return parBail;
}

// Baux affichés dans « Historique des baux » (relecture du commit 5b) :
// filtre « Afficher les archivés » décoché, un bail archivé reste affiché
// s'il porte au moins un remboursement actif (résilié puis archivé, ou
// brouillon archivé) — sinon le remède « archivez d'abord le
// remboursement » serait caché derrière le filtre.
export function bauxHistoriqueVisibles<B extends { id: string; statut: Bail["statut"] }>(
  baux: readonly B[],
  remboursements: readonly RemboursementListe[],
  afficherArchives: boolean
): B[] {
  if (afficherArchives) {
    return [...baux];
  }
  const avecRemboursementActif = new Set(
    remboursements.filter((remboursement) => remboursement.archivedAt === null).map((remboursement) => remboursement.bailId)
  );
  return baux.filter((bail) => bail.statut !== "archive" || avecRemboursementActif.has(bail.id));
}

export function libelleBoutonRemboursements(nbActifs: number): string {
  return `Remboursements (${nbActifs} ${nbActifs > 1 ? "actifs" : "actif"})`;
}

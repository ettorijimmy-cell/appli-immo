import type { Contact, ContactUnifie } from "./api";

export type LigneCarnet = ContactUnifie & { archive: boolean };

// Lignes du carnet de contacts. GET /contacts/unifie exclut déjà tout
// élément archivé (ContactsService.findAllUnifie) ; avec « Afficher les
// archivés », on y ajoute les seuls contacts professionnels archivés (lus
// via GET /contacts), les seuls archivables depuis le carnet — locataires,
// garants et candidats archivés restent sur leurs propres écrans.
export function lignesCarnet(
  unifies: readonly ContactUnifie[],
  contactsPro: readonly Contact[],
  afficherArchives: boolean
): LigneCarnet[] {
  const actives: LigneCarnet[] = unifies.map((c) => ({ ...c, archive: false }));
  if (!afficherArchives) {
    return actives;
  }
  const archives: LigneCarnet[] = contactsPro
    .filter((c) => c.archivedAt !== null)
    .map((c) => ({ type: c.role, id: c.id, nom: c.nom, telephone: c.telephone, email: c.email, archive: true }));
  return [...actives, ...archives];
}

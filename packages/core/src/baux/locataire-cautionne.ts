// Rattachement facultatif d'un garant au locataire du bail dont il se porte
// caution (garants.locataire_id, décision du 2026-11-08) :
// - null : « non précisé », aucune mention ;
// - locataire encore rattaché au bail (lien bail_locataires non archivé) :
//   mention « caution de [Prénom Nom] » dans le bail généré et à l'écran ;
// - locataire qui n'est plus au bail : la valeur est conservée, mais la
//   mention est omise du bail généré (le garant reste listé) et l'écran
//   indique « (n'est plus au bail) ».
// Partagé par la génération du bail (apps/backend) et les écrans garants
// (apps/desktop).

export type SituationLocataireCautionne = "non_precise" | "au_bail" | "plus_au_bail";

export function situationLocataireCautionne(
  locataireId: string | null,
  locataireIdsAuBail: readonly string[]
): SituationLocataireCautionne {
  if (locataireId === null) {
    return "non_precise";
  }
  return locataireIdsAuBail.includes(locataireId) ? "au_bail" : "plus_au_bail";
}

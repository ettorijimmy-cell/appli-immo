// Refus d'une date de fin de résiliation dans le futur (chantier archivage,
// décision 16 du 2026-11-13). Une résiliation passe le bail en « resilie »
// immédiatement : le job mensuel cesse aussitôt de générer les échéances,
// alors que BauxService.resilier() ne crée que celle du mois de fin. Avec
// une date future, les mois d'occupation entre aujourd'hui et la date de
// fin n'auraient jamais été facturés. On résilie donc le jour du départ ou
// après, avec la date de fin réelle.
//
// `aujourdHui` : date du jour à Paris (AAAA-MM-JJ), fournie par l'appelant
// (dateDuJourParis côté backend) — jamais lue ici, pour rester pur et
// testable. Seule la partie date de `dateFin` est comparée (le DTO accepte
// aussi un horodatage ISO complet). La date du jour elle-même est acceptée.
// null si la date est acceptée.
export const MESSAGE_DATE_FIN_RESILIATION_FUTURE = "Résiliez le bail à la date de départ ou après.";

export function refusDateFinResiliation(dateFin: string, aujourdHui: string): string | null {
  return dateFin.slice(0, 10) > aujourdHui ? MESSAGE_DATE_FIN_RESILIATION_FUTURE : null;
}

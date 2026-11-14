// Date du jour à Paris (AAAA-MM-JJ), comme le backend (dateDuJourParis,
// apps/backend/src/common/date-paris.ts) : sert de borne `max` aux champs
// date qui ne peuvent pas être dans le futur (date d'une entrée papier,
// date de fin d'une résiliation). Le format de la locale fr-CA est
// justement AAAA-MM-JJ. `reference` paramétrable pour les tests.
export function aujourdHuiParis(reference: Date = new Date()): string {
  return new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris" }).format(reference);
}

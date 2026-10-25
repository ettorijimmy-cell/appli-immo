// Date du jour (YYYY-MM-DD) dans le fuseau Europe/Paris — jamais
// `new Date().toISOString().slice(0, 10)`, qui donne la date UTC : entre
// minuit et 1h/2h du matin heure de Paris (selon heure d'été/hiver), ce
// calcul renvoie encore la date d'hier. Utilisé pour date_entree/
// date_sortie (EtatsDesLieuxSignatureService) — une signature posée à
// 23h50 heure de Paris doit porter la date du jour réellement vécu par
// les signataires, pas celle de Greenwich.
//
// Intl.DateTimeFormat (ICU intégré à Node, aucune dépendance ajoutée) +
// formatToParts plutôt qu'un format de locale fixe : insensible à l'ordre
// jour/mois/année ou au séparateur que la locale choisirait.
//
// `reference` paramétrable (défaut : l'instant présent) pour permettre un
// test déterministe autour de minuit, sans dépendre de l'heure réelle
// d'exécution des tests.
export function dateDuJourParis(reference: Date = new Date()): string {
  const parties = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(reference);
  const valeur = (type: "year" | "month" | "day"): string => {
    const partie = parties.find((p) => p.type === type);
    if (!partie) {
      throw new Error(`Intl.DateTimeFormat n'a pas produit de partie "${type}"`);
    }
    return partie.value;
  };
  return `${valeur("year")}-${valeur("month")}-${valeur("day")}`;
}

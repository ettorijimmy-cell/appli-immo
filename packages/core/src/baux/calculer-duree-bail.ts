export interface DureeBailLegale {
  duree: string;
  // Nombre de mois, pour tout calcul de date (ex. date de fin = date de
  // début + dureeMois, via `ajouterMois`) — `duree` reste un libellé
  // textuel, jamais parsable de façon fiable pour un calcul.
  dureeMois: number;
  texteLegal: string;
}

/**
 * Section III du contrat-type ("Date de prise d'effet et durée du
 * contrat"). Jamais une valeur déduite/stockée silencieusement — un choix
 * humain explicite à la génération (docs/data-dictionary.md, section
 * "Édition d'un bail") :
 *
 * - Bail vide : `immeubles.sci_id` est obligatoire dans le schéma actuel
 *   (aucun immeuble sans SCI) — le cas "bailleur particulier direct, 3 ans
 *   automatique" n'est donc jamais atteignable aujourd'hui et n'est
 *   volontairement PAS couvert ici. Le choix est toujours entre SCI
 *   familiale (réputée personne physique, article 10 de la loi n° 89-462
 *   du 6 juillet 1989 : 3 ans) et SCI non familiale/personne morale
 *   (6 ans) — rien dans le schéma (`scis`) ne distingue les deux, à
 *   trancher humainement à chaque génération.
 * - Bail meublé : 1 an par défaut, 9 mois si bail étudiant (article 25-7
 *   de la même loi, sans reconduction tacite) — un défaut existe mais
 *   reste confirmable/modifiable, jamais imposé.
 */
export type RegimeDureeBailVide = "sci_familiale" | "sci_non_familiale";
export type RegimeDureeBailMeuble = "standard" | "etudiant";

export type ChoixDureeBail =
  | { typeBail: "vide"; regime: RegimeDureeBailVide }
  | { typeBail: "meuble"; regime: RegimeDureeBailMeuble };

const LOI_1989 = "loi n° 89-462 du 6 juillet 1989";

export function calculerDureeBail(choix: ChoixDureeBail): DureeBailLegale {
  if (choix.typeBail === "vide") {
    if (choix.regime === "sci_familiale") {
      return {
        duree: "trois ans",
        dureeMois: 36,
        texteLegal: `Le bailleur étant réputé personne physique (SCI familiale, article 10 de la ${LOI_1989}), la durée du contrat est fixée à trois ans.`
      };
    }
    return {
      duree: "six ans",
      dureeMois: 72,
      texteLegal: `Le bailleur étant une personne morale (article 10 de la ${LOI_1989}), la durée du contrat est fixée à six ans.`
    };
  }

  if (choix.regime === "etudiant") {
    return {
      duree: "neuf mois",
      dureeMois: 9,
      texteLegal: `Le locataire justifiant du statut d'étudiant (article 25-7 de la ${LOI_1989}), la durée du contrat est fixée à neuf mois, sans reconduction tacite.`
    };
  }
  return {
    duree: "un an",
    dureeMois: 12,
    texteLegal: `Conformément à l'article 25-7 de la ${LOI_1989}, la durée du contrat est fixée à un an.`
  };
}

/**
 * Régimes valides et défaut proposé (s'il existe) pour un type de bail
 * donné — sert à déterminer si un choix humain est strictement requis
 * (vide : jamais de défaut, toujours à trancher) ou seulement
 * confirmable (meublé : un défaut existe).
 */
export function regimesDureeApplicables(typeBail: "vide" | "meuble"): {
  regimes: readonly string[];
  parDefaut: string | null;
} {
  if (typeBail === "vide") {
    return { regimes: ["sci_familiale", "sci_non_familiale"], parDefaut: null };
  }
  return { regimes: ["standard", "etudiant"], parDefaut: "standard" };
}

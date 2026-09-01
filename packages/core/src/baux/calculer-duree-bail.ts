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
 * - Bail vide, bailleur SCI (`bien.proprietaireType = 'sci'`) : choix
 *   toujours humain entre SCI familiale (réputée personne physique,
 *   article 10 de la loi n° 89-462 du 6 juillet 1989 : 3 ans) et SCI non
 *   familiale/personne morale (6 ans) — rien dans le schéma (`scis`) ne
 *   distingue les deux.
 * - Bail vide, bailleur personne physique (`bien.proprietaireType =
 *   'personne_physique'`, atteignable depuis la migration Bien,
 *   2026-08-25) : 3 ans, appliqué automatiquement, aucun choix humain —
 *   même durée que le cas SCI familiale, mais la qualité de bailleur est
 *   déjà connue avec certitude via `bien.proprietaireType`, contrairement
 *   au cas SCI où `estFamiliale` n'est jamais déductible du schéma.
 *   Ajouté le 2026-08-31 en corrigeant le bug bailleur de
 *   bail-document-docx.service.ts (voir docs/backlog.md) — CE COMMENTAIRE
 *   REMPLACE une version antérieure qui jugeait ce cas inatteignable
 *   (c'était vrai avant la migration Bien, plus depuis). Référence légale
 *   (article 10, loi n° 89-462) à vérifier avant tout usage réel de cette
 *   clause, comme pour les deux régimes SCI ci-dessus.
 * - Bail meublé : 1 an par défaut, 9 mois si bail étudiant (article 25-7
 *   de la même loi, sans reconduction tacite) — un défaut existe mais
 *   reste confirmable/modifiable, jamais imposé.
 */
export type RegimeDureeBailVide = "sci_familiale" | "sci_non_familiale" | "personne_physique";
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
    if (choix.regime === "personne_physique") {
      return {
        duree: "trois ans",
        dureeMois: 36,
        texteLegal: `Le bailleur étant une personne physique (article 10 de la ${LOI_1989}), la durée du contrat est fixée à trois ans.`
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
 *
 * "personne_physique" est volontairement ABSENT de la liste "vide" ci-dessous
 * : ce n'est jamais un choix humain (voir ChoixDureeBail/calculerDureeBail
 * ci-dessus), il est sélectionné automatiquement depuis
 * `bien.proprietaireType`, jamais proposé/confirmé par un appelant.
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

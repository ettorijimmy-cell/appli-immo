/**
 * Section VIII du contrat-type ("Clause résolutoire") — deux régimes
 * successifs, jamais un seul codé "pour l'instant" (docs/data-dictionary.md,
 * section "Édition d'un bail") :
 *
 * - Avant le 1er octobre 2026 : clause FACULTATIVE (texte vérifié sur la
 *   version en vigueur du décret n° 2015-587, article 4 g de la loi
 *   n° 89-462) — DEUX délais distincts, jamais un seul regroupé : deux
 *   mois pour loyer/charges/dépôt de garantie, un mois séparément pour
 *   assurance/troubles de voisinage. Corrigé après relecture du modèle
 *   Word du propriétaire (formule classique de la clause résolutoire),
 *   qui avait révélé qu'une première version de cette fonction regroupait
 *   à tort les deux motifs sous un délai unique d'un mois.
 * - À partir du 1er octobre 2026 : clause OBLIGATOIRE (décret n° 2026-596
 *   du 6 juillet 2026 modifiant le décret n° 2015-587, article 3 : "entre
 *   en vigueur le 1er octobre 2026 et s'applique aux contrats conclus ou
 *   renouvelés à compter de cette même date") — délai réduit à six
 *   semaines pour loyer/charges/dépôt de garantie, assurance et troubles de
 *   voisinage traités séparément avec leurs propres délais/conditions.
 *
 * Aucune "clause pénale" distincte : l'article 4 i) de la loi n° 89-462
 * interdit purement et simplement toute pénalité contractuelle, sans
 * exception — rien à générer, jamais de section séparée
 * (docs/data-dictionary.md).
 *
 * `dateReference` : la loi parle de contrats "conclus" à telle date — notre
 * schéma n'a pas de date de signature distincte de `dateDebut`, utilisée
 * ici comme approximation la plus proche disponible (limite documentée,
 * pas une certitude absolue).
 */

const DATE_BASCULE_2026_10_01 = "2026-10-01";

export type RegimeClauseResolutoire = "avant_2026_10_01" | "depuis_2026_10_01";

export function determinerRegimeClauseResolutoire(dateReference: string): RegimeClauseResolutoire {
  return dateReference >= DATE_BASCULE_2026_10_01 ? "depuis_2026_10_01" : "avant_2026_10_01";
}

export function construireTexteClauseResolutoire(
  regime: RegimeClauseResolutoire,
  servitudeResidencePrincipale: boolean
): string {
  if (regime === "avant_2026_10_01") {
    return (
      "Le contrat de location est résilié de plein droit pour défaut de paiement du loyer ou des charges aux termes convenus ou pour non versement du dépôt de garantie. La clause de résiliation de plein droit ne produit effet que deux mois après la date d'un commandement de payer demeuré infructueux. " +
      "Il en est de même, un mois après un commandement demeuré infructueux, en cas de non-souscription d'une assurance des risques locatifs, ou en cas de non-respect de l'obligation d'user paisiblement des locaux loués constaté par une décision de justice."
    );
  }

  let texte =
    "Le contrat de location est résilié de plein droit pour défaut de paiement du loyer ou des charges aux termes convenus ou pour non versement du dépôt de garantie. La clause de résiliation de plein droit ne produit effet que six semaines après la date d'un commandement de payer demeuré infructueux. " +
    "Il en est de même, un mois après un commandement demeuré infructueux, en cas de non-souscription d'une assurance des risques locatifs, ou en cas de non-respect de l'obligation d'user paisiblement des locaux loués constaté par une décision de justice.";

  // Motif ajouté par le même décret n° 2026-596 (annexe 1, section clause
  // résolutoire) : non-respect de la servitude de résidence principale
  // (art. L. 151-14-1 du code de l'urbanisme, issu de la loi n° 2024-1039)
  // — délai de mise en demeure distinct, fixé par le maire selon l'art.
  // L. 481-4, II du code de l'urbanisme, jamais les six semaines/un mois
  // ci-dessus. Texte verbatim (vérifié Légifrance, deux fetches
  // indépendants concordants), pas une paraphrase.
  if (servitudeResidencePrincipale) {
    texte +=
      " Il en est de même, lorsque le logement est soumis à l'obligation prévue à l'article L. 151-14-1 du code de l'urbanisme, pour le non-respect de l'obligation de l'occuper exclusivement à titre de résidence principale. Dans ce dernier cas, la clause ne peut produire effet qu'à l'expiration d'un délai de mise en demeure fixé par le maire conformément au II de l'article L. 481-4 du code de l'urbanisme.";
  }

  return texte;
}

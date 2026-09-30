// Correspondance entre depense.categorie (packages/db/src/schema/depense.ts,
// 7 valeurs) et les lignes automatiques du formulaire 2044 (revenus
// fonciers, biens détenus en nom propre) qu'elle alimente — même principe
// que mapping-categorie-annexe1.ts (2072-S, biens en SCI), périmètre
// resserré aux 4 lignes confirmées avec Jimmy après vérification des
// libellés officiels du formulaire (audit du 2026-09-30) :
//   221 Frais d'administration et de gestion -> frais_gestion (comptes 622+64)
//   223 Primes d'assurance                   -> assurance (compte 616)
//   224 Réparation, entretien, amélioration  -> reparation_entretien (compte 615)
//   227 Taxes foncières et annexes           -> impots_taxes (compte 63)
//
// Volontairement ABSENTES de ce mapping :
// - charges_copropriete (compte 614) : sa ligne réelle sur la 2044 est la
//   provision de copropriété (229 "provisions versées au syndic" / 230
//   "régularisation"), explicitement renvoyée au futur module de
//   régularisation des charges — PAS la ligne 225 ("charges locatives
//   récupérables restées impayées au départ du locataire"), un concept
//   différent lié à un bail précis et à son solde de sortie, sans rapport
//   avec les charges de copropriété courantes payées par le propriétaire.
//   Confondre les deux produirait un montant faux sur une ligne fiscale
//   réelle — décision actée avec Jimmy plutôt que devinée.
// - interets_emprunt (compte 6611) : sa ligne réelle est 250, hors
//   périmètre de cette tranche (donnée non suivie aujourd'hui).
// - "autre" : n'alimente aucune ligne, comme sur la 2072-S.
// Les lignes 225 et 226 (indemnités d'éviction — aucune catégorie PCG ne
// les représente) sont elles aussi hors périmètre de cette tranche : pas de
// saisie manuelle ouverte pour l'instant côté 2044, à reconsidérer plus
// tard si le besoin se confirme.
//
// Typé en chaînes plutôt que sur l'enum depense_categorie (packages/db,
// apps/backend uniquement) pour que packages/core reste sans dépendance
// vers un package consommateur — même convention que mapping-categorie-annexe1.ts.
export const LIGNE_2044_PAR_CATEGORIE_DEPENSE: Record<string, "ligne221" | "ligne223" | "ligne224" | "ligne227"> = {
  frais_gestion: "ligne221",
  assurance: "ligne223",
  reparation_entretien: "ligne224",
  impots_taxes: "ligne227"
};

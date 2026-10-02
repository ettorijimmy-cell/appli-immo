export interface PeriodeParDefaut {
  periodeDebut: string;
  periodeFin: string;
}

// Module Régularisation des charges, Sous-commit F — extrait de ChargesView
// pour rester testable indépendamment du cycle de vie React (le bug
// rapporté par Jimmy était une fuite de l'historique du bail PRÉCÉDEMMENT
// sélectionné pendant le chargement du nouveau, pas une erreur dans cette
// formule elle-même — voir le correctif dans ChargesView.tsx, effet de
// chargement de l'historique). Cette fonction reste la source de vérité
// unique du calcul, pour que ce genre de confusion reste détectable par un
// test unitaire pur, sans dépendre du rendu React.
//
// periodeDebut : reprend juste après la fin de la dernière période déjà
// couverte par un bilan (quel que soit son sens — une période en équilibre
// ou en faveur du locataire a quand même été réellement couverte), ou le
// début du bail si aucun bilan n'existe encore pour CE bail précisément —
// jamais une date arbitraire qui laisserait un angle mort sur les premiers
// mois jamais régularisés.
//
// periodeFin : la date de fin réelle du bail (`bail.dateFin`, posée une
// seule fois par BauxService.resilier()) si elle est renseignée, sinon
// aujourd'hui. Jamais "aujourd'hui" sans condition : calculerBilanPourBail
// (backend) filtre les charges par appartementId, pas par bailId — si un
// nouveau locataire occupe déjà le même logement, couvrir jusqu'à
// aujourd'hui inclurait à tort ses propres charges dans la régularisation
// du bail parti.
export function calculerPeriodeParDefaut(
  bilanLePlusRecent: { periodeFin: string } | null,
  bail: { dateDebut: string; dateFin: string | null } | null,
  aujourdhui: string
): PeriodeParDefaut {
  return {
    periodeDebut: bilanLePlusRecent?.periodeFin ?? bail?.dateDebut ?? "",
    periodeFin: bail?.dateFin ?? aujourdhui
  };
}

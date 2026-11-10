import type { VerificationGarantiesBail } from "../locataires/api";
import { resoudreAffichageChampManquant, type AffichageChampManquant } from "./libelles-champs-manquants";

export interface LigneAvertissementGarantie extends AffichageChampManquant {
  cle: string;
}

// Lignes de l'encadré « Garanties » de l'onglet « Bail actuel » : violations
// des règles d'acceptation, puis pièces manquantes (contrat Visale), dans
// l'ordre renvoyé par GET /baux/:id/verification-garanties. Mêmes libellés
// que les messages de la génération du bail (resoudreAffichageChampManquant).
// Liste vide : rien à afficher.
export function lignesAvertissementsGaranties(verification: VerificationGarantiesBail | null): LigneAvertissementGarantie[] {
  if (verification === null) {
    return [];
  }
  return [
    ...verification.violations.map((v, index) => ({
      cle: `violation-${index}-${v.code}`,
      ...resoudreAffichageChampManquant(v.message)
    })),
    ...verification.piecesManquantes.map((p) => ({
      cle: `piece-${p.garantId}-${p.code}`,
      ...resoudreAffichageChampManquant(p.message)
    }))
  ];
}

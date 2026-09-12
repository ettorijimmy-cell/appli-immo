import { centimesVersMontant, montantEnCentimes } from "../paiements/montant";

// Module Charges et fiscalité, Étape 4 (2072-S-A1-SD, cadre VII —
// "Détermination des revenus... par immeuble"). Fonction pure : les
// lignes automatiques (déjà agrégées depuis getRevenusLocatifs/depense
// côté backend) et les lignes de saisie manuelle (annexe1_saisie_manuelle)
// sont fournies en entrée, jamais recalculées ici depuis une source de
// données — cette fonction ne fait qu'assembler les totaux du formulaire.
export interface Annexe1LignesAutomatiques {
  ligne1: string;
  ligne6: string;
  ligne8: string;
  ligne9: string;
  ligne12: string;
  ligne13: string;
  ligne17: string;
  // Nombre de lots actifs du bien, utilisé pour la ligne 7 (20 €/lot) —
  // voir calculerForfaitLigne7 ci-dessous pour la limite documentée sur ce
  // comptage.
  nombreLots: number;
}

// Lignes fiscales trop spécifiques pour être dérivées automatiquement
// (subventions, indemnités d'éviction, régularisations d'années
// antérieures, déduction spécifique, rémunérations aux associés, parts
// dans d'autres sociétés) — jamais devinées, saisies par Jimmy
// (annexe1_saisie_manuelle). Toutes optionnelles : une ligne vide compte
// pour 0 dans les totaux, Jimmy ne remplit que ce qui le concerne
// réellement.
export interface Annexe1SaisieManuelle {
  ligne2?: string | null | undefined;
  ligne3?: string | null | undefined;
  ligne4?: string | null | undefined;
  // Ligne mémo ("dont..."), volontairement PAS incluse dans la somme de la
  // ligne 16 — cohérent avec le formulaire réel, où les lignes "bis" du
  // cadre VII détaillent une sous-partie d'une autre ligne plutôt que
  // d'ajouter un montant supplémentaire.
  ligne9Bis?: string | null | undefined;
  ligne10?: string | null | undefined;
  ligne11?: string | null | undefined;
  ligne14?: string | null | undefined;
  ligne15?: string | null | undefined;
  ligne19?: string | null | undefined;
  ligne20?: string | null | undefined;
  ligne22?: string | null | undefined;
}

export interface Annexe1Calculee {
  ligne1: string;
  ligne2: string;
  ligne3: string;
  ligne4: string;
  ligne5: string;
  ligne6: string;
  ligne7: string;
  ligne8: string;
  ligne9: string;
  ligne9Bis: string;
  ligne10: string;
  ligne11: string;
  ligne12: string;
  ligne13: string;
  ligne14: string;
  ligne15: string;
  ligne16: string;
  ligne17: string;
  ligne18: string;
  ligne19: string;
  ligne20: string;
  ligne21: string;
  ligne22: string;
  ligne23: string;
}

const FORFAIT_LIGNE_7_CENTIMES = 2000;

/**
 * Ligne 7 (forfait de frais de gestion) : 20 € par lot, montant fixe du
 * formulaire 2072-S-A1-SD. `nombreLots` doit être le nombre de lots NON
 * ARCHIVÉS au moment du calcul (limite documentée, docs/data-dictionary.md,
 * Étape 4 : aucune reconstitution de l'état réel du bien à une date
 * passée — un lot créé ou archivé en cours d'année compte comme s'il avait
 * existé toute l'année).
 */
export function calculerForfaitLigne7(nombreLots: number): string {
  return centimesVersMontant(FORFAIT_LIGNE_7_CENTIMES * nombreLots);
}

function versCentimesOuZero(valeur: string | null | undefined): number {
  if (valeur === null || valeur === undefined || valeur.trim() === "") {
    return 0;
  }
  return montantEnCentimes(valeur);
}

export function calculerAnnexe1(
  automatiques: Annexe1LignesAutomatiques,
  manuelle: Annexe1SaisieManuelle = {}
): Annexe1Calculee {
  const c1 = montantEnCentimes(automatiques.ligne1);
  const c2 = versCentimesOuZero(manuelle.ligne2);
  const c3 = versCentimesOuZero(manuelle.ligne3);
  const c4 = versCentimesOuZero(manuelle.ligne4);
  const c5 = c1 + c2 + c3 + c4;

  const c6 = montantEnCentimes(automatiques.ligne6);
  const c7 = montantEnCentimes(calculerForfaitLigne7(automatiques.nombreLots));
  const c8 = montantEnCentimes(automatiques.ligne8);
  const c9 = montantEnCentimes(automatiques.ligne9);
  const c9Bis = versCentimesOuZero(manuelle.ligne9Bis);
  const c10 = versCentimesOuZero(manuelle.ligne10);
  const c11 = versCentimesOuZero(manuelle.ligne11);
  const c12 = montantEnCentimes(automatiques.ligne12);
  const c13 = montantEnCentimes(automatiques.ligne13);
  const c14 = versCentimesOuZero(manuelle.ligne14);
  const c15 = versCentimesOuZero(manuelle.ligne15);
  // 9bis volontairement absente de cette somme, voir Annexe1SaisieManuelle.
  const c16 = c6 + c7 + c8 + c9 + c10 + c11 + c12 + c13 - c14 + c15;

  const c17 = montantEnCentimes(automatiques.ligne17);
  const c18 = c5 - c16 - c17;

  const c19 = versCentimesOuZero(manuelle.ligne19);
  const c20 = versCentimesOuZero(manuelle.ligne20);
  const c21 = c18 + c19 - c20;

  const c22 = versCentimesOuZero(manuelle.ligne22);
  const c23 = c21 + c22;

  return {
    ligne1: centimesVersMontant(c1),
    ligne2: centimesVersMontant(c2),
    ligne3: centimesVersMontant(c3),
    ligne4: centimesVersMontant(c4),
    ligne5: centimesVersMontant(c5),
    ligne6: centimesVersMontant(c6),
    ligne7: centimesVersMontant(c7),
    ligne8: centimesVersMontant(c8),
    ligne9: centimesVersMontant(c9),
    ligne9Bis: centimesVersMontant(c9Bis),
    ligne10: centimesVersMontant(c10),
    ligne11: centimesVersMontant(c11),
    ligne12: centimesVersMontant(c12),
    ligne13: centimesVersMontant(c13),
    ligne14: centimesVersMontant(c14),
    ligne15: centimesVersMontant(c15),
    ligne16: centimesVersMontant(c16),
    ligne17: centimesVersMontant(c17),
    ligne18: centimesVersMontant(c18),
    ligne19: centimesVersMontant(c19),
    ligne20: centimesVersMontant(c20),
    ligne21: centimesVersMontant(c21),
    ligne22: centimesVersMontant(c22),
    ligne23: centimesVersMontant(c23)
  };
}
